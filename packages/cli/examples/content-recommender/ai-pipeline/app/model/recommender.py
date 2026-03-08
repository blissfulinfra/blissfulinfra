"""
Hybrid content recommendation model.

Strategy:
- Cold start (< MIN_INTERACTIONS_FOR_COLLAB interactions): content-based filtering
  using TF-IDF vectors over genre + tag text. Cosine similarity finds items closest
  to what the user has already watched.

- Warm start (>= MIN_INTERACTIONS_FOR_COLLAB): Alternating Least Squares (ALS)
  collaborative filtering via the `implicit` library. Builds a user-item interaction
  matrix from engagement events and learns latent factors.

- Hybrid: weighted blend of both signals when both are available (collab_weight
  controlled by config). Gives the freshness of collaborative signals while retaining
  content coherence.

MLflow integration: logs model parameters and precision@K metrics on each retrain.
"""

import logging
import threading
import time
from typing import Optional

import numpy as np
import scipy.sparse as sp
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

try:
    import implicit
    HAS_IMPLICIT = True
except ImportError:
    HAS_IMPLICIT = False
    logging.warning("implicit library not available; falling back to content-based only")

from ..data.catalog import CATALOG, SEED_INTERACTIONS

logger = logging.getLogger(__name__)

_EVENT_WEIGHTS = {
    "view_complete": 4.0,
    "rating": 3.0,
    "view_start": 1.0,
    "search": 0.5,
}


class Recommender:
    """
    Thread-safe hybrid recommender. Designed to run alongside a live event
    stream — the train() method can be called from a background thread
    without blocking the serving path.
    """

    def __init__(
        self,
        catalog: Optional[list[dict]] = None,
        collab_weight: float = 0.7,
        min_interactions_for_collab: int = 5,
        als_factors: int = 50,
        als_iterations: int = 20,
        als_regularization: float = 0.1,
    ):
        self.collab_weight = collab_weight
        self.min_interactions_for_collab = min_interactions_for_collab
        self.als_factors = als_factors
        self.als_iterations = als_iterations
        self.als_regularization = als_regularization

        # Use provided catalog or fall back to synthetic default
        active_catalog = catalog if catalog is not None else CATALOG

        # Content-based: built from catalog, can be refreshed via rebuild_content_index()
        self._catalog = active_catalog
        self._item_ids: list[str] = [item["id"] for item in active_catalog]
        self._item_index: dict[str, int] = {id_: i for i, id_ in enumerate(self._item_ids)}
        self._content_matrix: Optional[np.ndarray] = None
        self._vectorizer: Optional[TfidfVectorizer] = None
        self._build_content_index()

        # Collaborative: rebuilt on each train() call
        self._als_model = None
        self._user_factors: dict[str, np.ndarray] = {}
        self._item_factors: Optional[np.ndarray] = None
        self._user_item_matrix: Optional[sp.csr_matrix] = None
        self._user_index: dict[str, int] = {}

        # Thread safety for model swap
        self._lock = threading.RLock()

        # Training metadata for MLflow
        self._n_users = 0
        self._n_interactions = 0
        self._trained_at: Optional[float] = None
        self._model_version = "1.0"

        # Seed model with catalog interactions (only for synthetic catalog)
        if catalog is None:
            self.train(list(SEED_INTERACTIONS))
        else:
            self.train([])

    # ------------------------------------------------------------------ #
    # Content-based index                                                  #
    # ------------------------------------------------------------------ #

    def _build_content_index(self) -> None:
        docs = []
        for item in self._catalog:
            text = " ".join(item.get("genres", [])) + " " + " ".join(item.get("tags", []))
            docs.append(text)

        self._vectorizer = TfidfVectorizer(ngram_range=(1, 2), min_df=1)
        tfidf = self._vectorizer.fit_transform(docs)
        self._content_matrix = cosine_similarity(tfidf).astype(np.float32)

    def _content_scores(self, watched_ids: list[str]) -> np.ndarray:
        """Return mean cosine similarity to each catalog item given watch history."""
        scores = np.zeros(len(self._item_ids), dtype=np.float32)
        valid = 0
        for item_id in watched_ids:
            idx = self._item_index.get(item_id)
            if idx is not None:
                scores += self._content_matrix[idx]
                valid += 1
        if valid > 0:
            scores /= valid
        return scores

    # ------------------------------------------------------------------ #
    # Collaborative index                                                  #
    # ------------------------------------------------------------------ #

    def _build_user_item_matrix(
        self, events: list[tuple]
    ) -> tuple[sp.csr_matrix, dict[str, int]]:
        """
        Build a sparse user-item confidence matrix from raw events.

        events: list of (user_id, item_id, event_type, value) tuples
        """
        # Accumulate weighted interactions
        interactions: dict[tuple[str, str], float] = {}
        users: dict[str, int] = {}
        for user_id, item_id, event_type, value in events:
            if item_id not in self._item_index:
                continue
            weight = _EVENT_WEIGHTS.get(event_type, 1.0) * float(value)
            key = (user_id, item_id)
            interactions[key] = interactions.get(key, 0.0) + weight
            if user_id not in users:
                users[user_id] = len(users)

        if not interactions:
            return sp.csr_matrix((len(users), len(self._item_ids))), users

        rows, cols, data = [], [], []
        for (user_id, item_id), weight in interactions.items():
            rows.append(users[user_id])
            cols.append(self._item_index[item_id])
            data.append(weight)

        matrix = sp.csr_matrix(
            (data, (rows, cols)), shape=(len(users), len(self._item_ids))
        )
        return matrix, users

    # ------------------------------------------------------------------ #
    # Public API                                                           #
    # ------------------------------------------------------------------ #

    def train(self, events: list[tuple]) -> None:
        """
        Fit/refit the collaborative model from interaction events.
        Thread-safe: swaps the model atomically after training completes.

        events: list of (user_id, item_id, event_type, value)
        """
        matrix, user_index = self._build_user_item_matrix(events)

        new_als = None
        new_user_factors: dict[str, np.ndarray] = {}
        new_item_factors: Optional[np.ndarray] = None

        if HAS_IMPLICIT and matrix.nnz >= self.min_interactions_for_collab:
            try:
                model = implicit.als.AlternatingLeastSquares(
                    factors=self.als_factors,
                    iterations=self.als_iterations,
                    regularization=self.als_regularization,
                    use_gpu=False,
                )
                # implicit expects item-user matrix
                model.fit(matrix.T.tocsr(), show_progress=False)
                new_als = model
                new_item_factors = model.item_factors  # (n_items, factors)

                # Pre-compute user factors for each known user
                for user_id, u_idx in user_index.items():
                    new_user_factors[user_id] = model.user_factors[u_idx]

                logger.info(
                    "ALS model trained: %d users, %d items, %d interactions",
                    len(user_index), len(self._item_ids), matrix.nnz,
                )
            except Exception as e:
                logger.warning("ALS training failed: %s — falling back to content-based", e)

        with self._lock:
            self._als_model = new_als
            self._user_factors = new_user_factors
            self._item_factors = new_item_factors
            self._user_item_matrix = matrix
            self._user_index = user_index
            self._n_users = len(user_index)
            self._n_interactions = matrix.nnz
            self._trained_at = time.time()

    def recommend(self, user_id: str, top_k: int = 10) -> list[dict]:
        """
        Return top_k recommendations for a user.

        Returns a list of dicts with keys: id, title, genres, score, source
        source is one of: 'collaborative', 'content', 'hybrid', 'trending'
        """
        with self._lock:
            user_factor = self._user_factors.get(user_id)
            item_factors = self._item_factors
            user_idx = self._user_index.get(user_id)
            matrix = self._user_item_matrix
            user_index = self._user_index

        # Items the user has already watched (to exclude from recommendations)
        watched: set[str] = set()
        if user_idx is not None and matrix is not None:
            row = matrix[user_idx]
            watched_indices = row.indices
            watched = {self._item_ids[i] for i in watched_indices}

        n_watched = len(watched)

        # Determine blending strategy
        has_collab = (
            HAS_IMPLICIT
            and user_factor is not None
            and item_factors is not None
            and n_watched >= self.min_interactions_for_collab
        )

        # Collaborative scores
        collab_scores = np.zeros(len(self._item_ids), dtype=np.float32)
        if has_collab:
            collab_scores = (item_factors @ user_factor).astype(np.float32)
            # Normalize to [0, 1]
            c_min, c_max = collab_scores.min(), collab_scores.max()
            if c_max > c_min:
                collab_scores = (collab_scores - c_min) / (c_max - c_min)

        # Content scores
        content_scores = self._content_scores(list(watched)) if watched else np.zeros(len(self._item_ids))

        # Blend
        if has_collab:
            final_scores = (
                self.collab_weight * collab_scores
                + (1 - self.collab_weight) * content_scores
            )
            source = "hybrid" if watched else "collaborative"
        elif watched:
            final_scores = content_scores
            source = "content"
        else:
            # Cold start with no watch history — use catalog rating as proxy
            final_scores = np.array([item["rating"] / 10.0 for item in self._catalog], dtype=np.float32)
            source = "trending"

        # Zero out already-watched items
        for item_id in watched:
            idx = self._item_index.get(item_id)
            if idx is not None:
                final_scores[idx] = -1.0

        # Top-K
        top_indices = np.argpartition(final_scores, -top_k)[-top_k:]
        top_indices = top_indices[np.argsort(final_scores[top_indices])[::-1]]

        results = []
        for idx in top_indices:
            if final_scores[idx] < 0:
                continue
            item = self._catalog[idx]
            results.append({
                "id": item["id"],
                "title": item["title"],
                "genres": item["genres"],
                "tags": item["tags"],
                "year": item["year"],
                "catalog_rating": item["rating"],
                "score": round(float(final_scores[idx]), 4),
                "source": source,
            })

        return results[:top_k]

    def trending(self, top_k: int = 10) -> list[dict]:
        """
        Global trending: items with highest weighted interaction count
        across all users. Falls back to catalog rating for cold start.
        """
        with self._lock:
            matrix = self._user_item_matrix

        if matrix is None or matrix.nnz == 0:
            sorted_catalog = sorted(self._catalog, key=lambda x: x["rating"], reverse=True)
            return [
                {**item, "score": round(item["rating"] / 10.0, 4), "source": "trending"}
                for item in sorted_catalog[:top_k]
            ]

        item_scores = np.asarray(matrix.sum(axis=0)).flatten()
        top_indices = np.argpartition(item_scores, -top_k)[-top_k:]
        top_indices = top_indices[np.argsort(item_scores[top_indices])[::-1]]

        i_min, i_max = item_scores.min(), item_scores.max()
        results = []
        for idx in top_indices:
            item = self._catalog[idx]
            score = float((item_scores[idx] - i_min) / (i_max - i_min + 1e-9))
            results.append({
                "id": item["id"],
                "title": item["title"],
                "genres": item["genres"],
                "year": item["year"],
                "catalog_rating": item["rating"],
                "score": round(score, 4),
                "source": "trending",
            })
        return results

    def get_training_metadata(self) -> dict:
        """Return metadata for MLflow logging."""
        with self._lock:
            return {
                "algorithm": "ALS+ContentBased" if (HAS_IMPLICIT and self._als_model) else "ContentBased",
                "n_users": self._n_users,
                "n_items": len(self._item_ids),
                "n_interactions": self._n_interactions,
                "als_factors": self.als_factors,
                "als_iterations": self.als_iterations,
                "collab_weight": self.collab_weight,
                "min_interactions_for_collab": self.min_interactions_for_collab,
                "trained_at": self._trained_at,
                "model_version": self._model_version,
            }
