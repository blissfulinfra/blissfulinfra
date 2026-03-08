"""
ClickHouse storage layer for the content recommender.

Three tables:
  articles          — scraped HN articles (deduped by id via ReplacingMergeTree)
  user_events       — raw engagement signals (view_start, view_complete, rating, search)
  recommendations   — model output, deduplicated by (user_id, item_id) via ReplacingMergeTree

All writes are best-effort: if ClickHouse is unreachable the pipeline continues
with in-memory state.
"""

import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

_client = None  # module-level connection, set by init_tables()


def init_tables(host: str, port: int, database: str) -> bool:
    """
    Connect to ClickHouse and create tables if they don't exist.
    Returns True on success, False if ClickHouse is unreachable.
    """
    global _client
    try:
        import clickhouse_connect

        _client = clickhouse_connect.get_client(host=host, port=port, database=database)
        _client.command(f"CREATE DATABASE IF NOT EXISTS {database}")

        # Articles scraped from HN — ReplacingMergeTree dedupes on id
        _client.command(f"""
            CREATE TABLE IF NOT EXISTS {database}.articles (
                id          String,
                title       String,
                url         String,
                score       Int32,
                tags        Array(String),
                scraped_at  DateTime DEFAULT now()
            )
            ENGINE = ReplacingMergeTree(scraped_at)
            ORDER BY id
        """)

        _client.command(f"""
            CREATE TABLE IF NOT EXISTS {database}.user_events (
                timestamp   DateTime DEFAULT now(),
                user_id     String,
                item_id     String,
                event_type  LowCardinality(String),
                value       Float32
            )
            ENGINE = MergeTree()
            ORDER BY (user_id, timestamp)
            PARTITION BY toYYYYMM(timestamp)
            TTL timestamp + INTERVAL 90 DAY
        """)

        _client.command(f"""
            CREATE TABLE IF NOT EXISTS {database}.recommendations (
                timestamp   DateTime DEFAULT now(),
                user_id     String,
                item_id     String,
                title       String,
                genres      String,
                score       Float32,
                model_ver   String,
                source      LowCardinality(String)
            )
            ENGINE = ReplacingMergeTree(timestamp)
            ORDER BY (user_id, item_id)
        """)

        logger.info("ClickHouse tables initialized at %s:%d/%s", host, port, database)
        return True

    except Exception as e:
        logger.warning("ClickHouse unavailable (%s) — running without persistent storage", e)
        _client = None
        return False


def store_event(
    user_id: str,
    item_id: str,
    event_type: str,
    value: float,
) -> None:
    """Persist a single engagement event. No-op if ClickHouse is down."""
    if _client is None:
        return
    try:
        _client.insert(
            "user_events",
            [[datetime.utcnow(), user_id, item_id, event_type, value]],
            column_names=["timestamp", "user_id", "item_id", "event_type", "value"],
        )
    except Exception as e:
        logger.debug("Failed to store event: %s", e)


def store_recommendations(
    user_id: str,
    recs: list[dict],
    model_ver: str = "1.0",
) -> None:
    """
    Write a fresh set of recommendations for a user.
    ReplacingMergeTree deduplicates on (user_id, item_id), keeping the newest row.
    """
    if _client is None or not recs:
        return
    try:
        now = datetime.utcnow()
        rows = [
            [
                now,
                user_id,
                r["id"],
                r["title"],
                ",".join(r.get("genres", [])),
                r["score"],
                model_ver,
                r.get("source", "unknown"),
            ]
            for r in recs
        ]
        _client.insert(
            "recommendations",
            rows,
            column_names=["timestamp", "user_id", "item_id", "title", "genres", "score", "model_ver", "source"],
        )
    except Exception as e:
        logger.debug("Failed to store recommendations: %s", e)


def get_recommendations(user_id: str, top_k: int = 10) -> list[dict]:
    """
    Fetch latest recommendations for a user from ClickHouse.
    Returns empty list if ClickHouse is down or no recs exist yet.
    """
    if _client is None:
        return []
    try:
        # FINAL forces deduplication of ReplacingMergeTree before returning
        result = _client.query(
            f"""
            SELECT item_id, title, genres, score, model_ver, source
            FROM recommendations FINAL
            WHERE user_id = %(user_id)s
            ORDER BY score DESC
            LIMIT %(top_k)s
            """,
            parameters={"user_id": user_id, "top_k": top_k},
        )
        return [
            {
                "id": row[0],
                "title": row[1],
                "genres": row[2].split(",") if row[2] else [],
                "score": row[3],
                "model_ver": row[4],
                "source": row[5],
            }
            for row in result.result_rows
        ]
    except Exception as e:
        logger.debug("Failed to fetch recommendations: %s", e)
        return []


def get_all_events(database: str = "pipeline_db") -> list[tuple]:
    """
    Load all stored events for retraining.
    Returns list of (user_id, item_id, event_type, value) tuples.
    """
    if _client is None:
        return []
    try:
        result = _client.query(
            f"SELECT user_id, item_id, event_type, value FROM {database}.user_events"
        )
        return [(r[0], r[1], r[2], r[3]) for r in result.result_rows]
    except Exception as e:
        logger.debug("Failed to load events for retraining: %s", e)
        return []


def event_count(database: str = "pipeline_db") -> int:
    """Return total number of stored events."""
    if _client is None:
        return 0
    try:
        result = _client.query(f"SELECT count() FROM {database}.user_events")
        return int(result.result_rows[0][0])
    except Exception:
        return 0


# ---------------------------------------------------------------------------
# Article store — populated by the Scrapy scraper via Kafka
# ---------------------------------------------------------------------------

def store_article(article: dict) -> None:
    """
    Upsert a scraped article.
    ReplacingMergeTree deduplicates on id, so re-scraping the same HN story is a no-op.
    """
    if _client is None:
        return
    try:
        from datetime import datetime
        _client.insert(
            "articles",
            [[
                article["id"],
                article.get("title", ""),
                article.get("url", ""),
                int(article.get("score", 0)),
                article.get("tags", []),
                datetime.utcnow(),
            ]],
            column_names=["id", "title", "url", "score", "tags", "scraped_at"],
        )
    except Exception as e:
        logger.debug("Failed to store article %s: %s", article.get("id"), e)


def get_articles(limit: int = 500) -> list[dict]:
    """
    Load scraped articles for catalog building.
    Returns empty list if ClickHouse is down or no articles exist yet.
    """
    if _client is None:
        return []
    try:
        result = _client.query(
            f"""
            SELECT id, title, url, score, tags
            FROM articles FINAL
            ORDER BY score DESC
            LIMIT %(limit)s
            """,
            parameters={"limit": limit},
        )
        return [
            {
                "id": row[0],
                "title": row[1],
                "url": row[2],
                "score": row[3],
                "tags": list(row[4]),
            }
            for row in result.result_rows
        ]
    except Exception as e:
        logger.debug("Failed to load articles: %s", e)
        return []


def article_count() -> int:
    """Return number of scraped articles stored in ClickHouse."""
    if _client is None:
        return 0
    try:
        result = _client.query("SELECT count() FROM articles FINAL")
        return int(result.result_rows[0][0])
    except Exception:
        return 0
