# Content Recommender. Reference Example

A real-time personalized content recommendation system built with blissful-infra.

## The Problem

A streaming platform has a catalog of movies and shows. As users browse, watch, and rate content, the platform needs to:

1. **Capture engagement signals** in real time (view starts, completions, ratings, searches)
2. **Generate personalized recommendations** for each user, updating as their history grows
3. **Handle cold start gracefully**: new users with no history still get relevant suggestions
4. **Track model performance** across versions as the user base grows
5. **Retrain automatically** when enough new behavioral data accumulates

This is one of the core engineering challenges at companies like Netflix, Spotify, and YouTube. It requires event streaming, ML serving, columnar storage for analytics, and experiment tracking, all working together in real time.

## How blissful-infra Solves It

A single command stands up the entire platform:

```bash
blissful-infra start content-recommender --backend spring-boot --database postgres --plugins ai-pipeline
```

The framework wires together:

| Service       | Role                                                            | URL                             |
|---------------|-----------------------------------------------------------------|---------------------------------|
| Spring Boot   | Content catalog API, event ingestion, user sessions             | http://localhost:8080           |
| React          | Browse catalog, display recommendations, emit events           | http://localhost:3000           |
| Kafka         | Durable event stream between backend and ML service             | localhost:9092                  |
| AI Pipeline   | Real-time recommendation engine (ALS + content-based hybrid)   | http://localhost:8090/docs      |
| ClickHouse    | Columnar store for events and recommendations (fast at scale)   | http://localhost:8123/play      |
| MLflow        | Experiment tracking, model versioning, metric comparison        | http://localhost:5001           |
| Mage          | Visual pipeline for scheduled retraining and batch jobs         | http://localhost:6789           |
| Postgres      | User accounts, session state, content metadata                  | localhost:5432                  |
| Grafana       | Dashboards for recommendation CTR, model latency, event volume  | http://localhost:3001           |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Browser                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  React Frontend                                          │  │
│  │  • Browse catalog     • View recommendations             │  │
│  │  • Click / watch      • POST /events on interactions     │  │
│  └──────────────┬───────────────────────┬────────────────── ┘  │
└─────────────────┼───────────────────────┼────────────────────── ┘
                  │  REST                 │  REST
         ┌────────▼────────┐    ┌─────────▼──────────┐
         │  Spring Boot    │    │   Spring Boot       │
         │  Event Ingest   │    │  Recommendations    │
         │  POST /events   │    │  GET /recs/{user}   │
         └────────┬────────┘    └─────────┬──────────┘
                  │ publish               │ query
         ┌────────▼────────┐    ┌─────────▼──────────┐
         │     Kafka       │    │    ClickHouse       │
         │  content-events │    │  recommendations    │◄──────┐
         └────────┬────────┘    │  user_events        │       │
                  │ consume     └─────────────────────┘       │
         ┌────────▼───────────────────────────────────────┐   │
         │              AI Pipeline (FastAPI)              │   │
         │                                                 │   │
         │  POST /events  ──► store_event() ──────────────────►│
         │  GET /recommendations/{user_id}                 │   │
         │                                                 │   │
         │  ┌─────────────────────────────────────────┐   │   │
         │  │  Hybrid Recommender                     │   │   │
         │  │                                         │   │   │
         │  │  Cold start: TF-IDF content similarity  │   │   │
         │  │  Warm start: ALS collaborative filtering │   │   │
         │  │  Blend: collab_weight * ALS              │   │   │
         │  │        + (1 - collab_weight) * content   │   │   │
         │  │                                         │   │   │
         │  │  Retrain trigger: every N events ───────────►│   │
         │  └─────────────────────────────────────────┘   │   │
         │                          │                      │   │
         │                          ▼                      │   │
         │               ┌─────────────────┐               │   │
         │               │     MLflow      │               │   │
         │               │  Log params     │               │   │
         │               │  Log metrics    │               │   │
         │               │  Model registry │               │   │
         │               └─────────────────┘               │   │
         └─────────────────────────────────────────────────┘   │
                                                                │
         ┌──────────────────────────────────────────────────┐  │
         │  Mage (scheduled)                                │  │
         │  • Nightly full retrain on all historical events │  │
         │  • Batch export of recommendations to ClickHouse ├──►│
         │  • Data quality checks on user_events table      │  │
         └──────────────────────────────────────────────────┘
```

---

## The Recommendation Model

The AI pipeline uses a **hybrid recommender** that blends two signals:

### 1. Content-Based Filtering (cold start)
When a user has little or no history, we recommend items similar to what they've watched using **TF-IDF vectors** built from genres and tags. Cosine similarity finds the nearest items in that feature space.

```
user watches: Inception (sci-fi, mind-bending, heist)
              ↓
TF-IDF vector → cosine similarity → Interstellar, Arrival, Ex Machina
```

### 2. Collaborative Filtering. ALS (warm start)
Once a user has enough interactions (configurable `MIN_INTERACTIONS_FOR_COLLAB`), we switch to **Alternating Least Squares** via the `implicit` library. ALS learns latent factors for users and items from a sparse user-item confidence matrix, capturing "users like you also watched" patterns across the full user base.

### 3. Hybrid Blend
```
final_score = collab_weight * ALS_score + (1 - collab_weight) * content_score
```

The default `collab_weight=0.7` favors collaborative signals while retaining content coherence. This is tunable and can be A/B tested via MLflow.

### Automatic Retraining
Every `RETRAIN_THRESHOLD` events (default: 50), the model refits in a background thread without blocking serving. Events are loaded from ClickHouse for durability. Each retrain logs to MLflow for comparison.

---

## Quickstart

```bash
# 1. Install blissful-infra
npm install -g blissful-infra

# 2. Start the full platform
blissful-infra start content-recommender --backend spring-boot --database postgres --plugins ai-pipeline

# 3. Open the dashboard
blissful-infra dashboard
```

### Try It

```bash
# Ingest some engagement events
curl -X POST http://localhost:8090/events \
  -H "Content-Type: application/json" \
  -d '{"user_id": "alice", "item_id": "m001", "event_type": "view_complete", "value": 1.0}'

curl -X POST http://localhost:8090/events \
  -H "Content-Type: application/json" \
  -d '{"user_id": "alice", "item_id": "m003", "event_type": "view_complete", "value": 1.0}'

# Get personalized recommendations
curl http://localhost:8090/recommendations/alice

# See what's trending globally
curl http://localhost:8090/trending

# Browse the full catalog
curl http://localhost:8090/catalog

# Check model status
curl http://localhost:8090/model/status
```

### Explore the Data

```sql
-- Open ClickHouse SQL editor: http://localhost:8123/play

-- See all engagement events
SELECT user_id, item_id, event_type, value, timestamp
FROM recommender_db.user_events
ORDER BY timestamp DESC
LIMIT 20;

-- Top recommended items for alice
SELECT item_id, title, score, source, model_ver
FROM recommender_db.recommendations FINAL
WHERE user_id = 'alice'
ORDER BY score DESC;

-- Most engaged content globally
SELECT item_id, count() as events, sum(value) as total_weight
FROM recommender_db.user_events
WHERE event_type = 'view_complete'
GROUP BY item_id
ORDER BY total_weight DESC
LIMIT 10;
```

### Compare Model Versions in MLflow

Open http://localhost:5001 to see experiment runs. Each retraining cycle logs:
- **Parameters**: algorithm, ALS factors, collab_weight, min_interactions_for_collab
- **Metrics**: n_users, n_items, n_interactions

---

## Project Structure

```
content-recommender/
├── blissful-infra.yaml           # Project config: backend, database, plugins
│
├── ai-pipeline/                  # Recommendation service
│   ├── requirements.txt
│   └── app/
│       ├── main.py               # FastAPI app + recommendation endpoints
│       ├── config.py             # Environment configuration
│       ├── data/
│       │   └── catalog.py        # 50-item synthetic content catalog + seed interactions
│       ├── model/
│       │   └── recommender.py    # Hybrid ALS + content-based model
│       └── store/
│           └── recommendations.py  # ClickHouse schema, read/write helpers
│
├── backend/                      # Generated: Spring Boot (Kotlin)
│   └── src/                      # Event ingestion, catalog proxy, recommendations API
│
├── frontend/                     # Generated: React + Vite
│   └── src/                      # Content browse, recommendation panel, event tracking
│
├── docker-compose.yaml           # Generated: all services wired together
└── [prometheus/, grafana/, k8s/, Jenkinsfile]  # Generated: observability + CI/CD
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TOP_K` | `10` | Number of recommendations to return |
| `RETRAIN_THRESHOLD` | `50` | Events before triggering a background retrain |
| `MIN_INTERACTIONS_FOR_COLLAB` | `5` | Minimum user events before switching to ALS |
| `COLLAB_WEIGHT` | `0.7` | Weight of collaborative vs. content signal (0–1) |
| `CLICKHOUSE_DB` | `recommender_db` | ClickHouse database name |
| `MLFLOW_EXPERIMENT` | `content-recommender-recommender` | MLflow experiment name |

---

## Extending This Example

**Add more content types**: extend `catalog.py` with podcasts, articles, or playlists. The model works on any item with genre/tag features.

**A/B test model variants**: change `COLLAB_WEIGHT` per experiment, log to separate MLflow runs, compare precision@K across runs.

**Scheduled retraining**: open Mage at http://localhost:6789 and create a `retrain_pipeline` that calls `GET /model/status`, loads all events from ClickHouse, and triggers `recommender.train()` nightly.

**Implicit feedback weighting**: modify `_EVENT_WEIGHTS` in `recommender.py` to experiment with different confidence scores per event type (e.g., weight completions higher than starts).

**Real Kafka consumer**: wire `kafka_utils.py` from the base ai-pipeline template to consume `content-events` from Kafka automatically, rather than waiting for direct API calls.
