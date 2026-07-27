# examples/, Example Applications

Fully-working example projects that demonstrate the blissful-infra platform. These are shipped inside the `@blissful-infra/cli` npm package and scaffold-able via:

```bash
blissful-infra example content-recommender
```

See root [CLAUDE.md](../CLAUDE.md) and [packages/cli/CLAUDE.md](../packages/cli/CLAUDE.md) for context.

---

## How examples are distributed

Examples live in `examples/` in the source repo. At CLI build time (`npm run build:cli`), they are copied into `packages/cli/dist/examples/`. The `example` command reads from `dist/examples/` at runtime.

When `blissful-infra example <name>` runs:
1. Copies `dist/examples/<name>/` into the current directory
2. Reads `blissful-infra.yaml` from the example to determine config
3. Runs the same scaffolding + `docker compose up` as `blissful-infra start`

---

## content-recommender

**Path:** `examples/content-recommender/`

**Config (`blissful-infra.yaml`):**
```yaml
project: content-recommender
backend: spring-boot
database: postgres
plugins:
  - type: ai-pipeline
  - type: scraper
```

**What it demonstrates:**
- Event-driven architecture with Kafka as the message bus
- ML pipeline (TF-IDF + ALS collaborative filtering) running as a sidecar service
- Real-world data ingestion via a Scrapy spider scraping Hacker News
- ClickHouse as an analytical datastore (fast aggregations over article/interaction data)
- MLflow for experiment tracking and model versioning
- Full-stack integration: Spring Boot API → Kafka → AI Pipeline → React frontend

**Services:**

| Service | Directory | Role |
|---|---|---|
| Spring Boot API | `backend/` (scaffolded from template) | REST API, Kafka producer/consumer |
| Postgres | (docker image) | Relational store |
| AI Pipeline | `ai-pipeline/` | FastAPI + scikit-learn; trains TF-IDF + ALS models |
| Scraper | `scraper/` | Scrapy spider, crawls HN public API every 15 min, publishes to Kafka |

**Data flow:**
```
Scrapy (HN API → Kafka scraped-articles)
  → AI Pipeline (Kafka consumer → stores articles in ClickHouse)
  → Recommender trains on real articles (TF-IDF on title+tags, ALS on interactions)
  → GET /recommendations/user1 returns ranked article list
```

**Key AI Pipeline endpoints:**

| Endpoint | Purpose |
|---|---|
| `GET /catalog` | Returns articles (scraped or synthetic fallback) |
| `GET /catalog/source` | `{"source": "scraped"\|"synthetic", "count": N}` |
| `GET /recommendations/:userId` | Ranked article recommendations |
| `POST /events` | Log a user interaction (view, click, like) |

**Graceful fallback:** The AI Pipeline uses a 50-item synthetic movie catalog until the first scrape completes (~15 minutes after first boot). Once ClickHouse has articles, it switches automatically.

---

## Adding a new example

1. Create `examples/<name>/` with a `blissful-infra.yaml` and any service directories needed.
2. The `blissful-infra.yaml` must declare `project`, `backend`, `database`, and `plugins`.
3. Service directories (e.g., `ai-pipeline/`, `scraper/`) must have a `Dockerfile`.
4. Run `npm run build:cli` to copy the example into `dist/examples/`.
5. Test with `blissful-infra example <name>`.

Keep examples realistic and runnable, they are the primary way users evaluate the platform.
