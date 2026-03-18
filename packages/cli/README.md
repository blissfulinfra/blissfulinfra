# @blissful-infra/cli

One command creates and runs a full-stack app with CI/CD, observability, and an AI agent — no cloud required.

```bash
npm install -g @blissful-infra/cli
blissful-infra start my-app
```

## What you get

- **Backend** — Kotlin/Spring Boot, Python/FastAPI, Node/Express, or Go/Chi
- **Frontend** — React + Vite or Next.js, both with TypeScript and Tailwind
- **Database** — Postgres with Flyway migrations, Redis caching, or both
- **Kafka** — event bus wired between backend and frontend via WebSockets + SSE
- **Observability** — Prometheus, Grafana, Loki, and Jaeger provisioned automatically
- **CI/CD** — Jenkins pipeline with a generated Jenkinsfile, Docker registry included
- **AI agent** — Ask Claude or Ollama to diagnose errors, analyze logs, and explain metrics
- **MCP server** — Let Claude orchestrate your entire local platform via natural language

## Quickstart

**Prerequisites:** Docker Desktop running, Node.js 18+

```bash
# Install
npm install -g @blissful-infra/cli

# Create and start a project
blissful-infra start my-app --backend spring-boot --database postgres

# Open the dashboard
blissful-infra dashboard
```

Your app is running at:

| Service    | URL                       |
|------------|---------------------------|
| Frontend   | http://localhost:3000     |
| Backend    | http://localhost:8080     |
| Grafana    | http://localhost:3001     |
| Dashboard  | http://localhost:3002     |
| Jenkins    | http://localhost:8081     |

## Commands

```bash
blissful-infra start <name>       # Create and run a new project
blissful-infra up [name]          # Start an existing project
blissful-infra down [name]        # Stop a project
blissful-infra dashboard          # Launch the web dashboard
blissful-infra logs [name]        # View logs
blissful-infra mcp                # Start MCP server for Claude
blissful-infra example [name]     # Scaffold a reference example
blissful-infra deploy [name]      # Deploy to an environment
blissful-infra agent [name]       # AI debugging agent
```

## Options

```bash
--backend   spring-boot | fastapi | express | go-chi  (default: spring-boot)
--frontend  react-vite | nextjs                        (default: react-vite)
--database  none | postgres | redis | postgres-redis   (default: postgres)
--plugins   ai-pipeline | scraper                      (comma-separated)
```

## MCP Server

blissful-infra ships an MCP server so Claude can manage your infrastructure directly.

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "blissful-infra": {
      "command": "npx",
      "args": ["-y", "@blissful-infra/cli", "mcp"]
    }
  }
}
```

Then ask Claude things like:
- "What's the health of all my projects?"
- "Show me ERROR logs from the backend in my-app"
- "Why is the backend restarting? Diagnose it."
- "Deploy my-app to staging"

## Examples

Reference implementations for real-world use cases:

```bash
blissful-infra example content-recommender
cd content-recommender && blissful-infra up
```

| Example | Stack |
|---------|-------|
| `content-recommender` | Spring Boot + ALS collaborative filtering + ClickHouse + MLflow + Scrapy |

## Links

- [GitHub](https://github.com/cavanpage/blissful-infra)
- [Docs](https://cavanpage.github.io/blissful-infra)
- [Issues](https://github.com/cavanpage/blissful-infra/issues)
