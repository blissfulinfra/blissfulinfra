---
title: The client warehouse (ClickHouse + LocalStack)
description: A client-level analytical warehouse. ClickHouse for queries, LocalStack S3 for object storage, both shared across services and plugins.
---

A blissful-infra client can run a **shared analytical warehouse** that all
its services and plugins read from and write to. ClickHouse provides the
columnar query layer; LocalStack provides S3-compatible object storage.
Together they form a real lakehouse pattern locally. ClickHouse can read
parquet files directly from LocalStack S3 via the `s3()` table function.

This is the foundation for forecasting, analytics, anomaly detection, and
anything else that needs structured analytical data shared across services.

See [ADR-0008](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0008-clickhouse-as-client-level-warehouse.md)
for the rationale.

## Enable the warehouse on a client

```bash
# Interactive: tick "ClickHouse" and "LocalStack" in the prompt
blissful-infra client create acme-corp

# Or manually edit ~/.blissful-infra/clients/<client>/blissful-infra.yaml:
# infrastructure:
#   clickhouse: true
#   localstack: true
```

## Topology

```mermaid
flowchart LR
    subgraph client["Client (network: <client>_infra)"]
      ch[(ClickHouse warehouse<br/>port 8120+blockIndex)]
      ls[(LocalStack S3<br/>port 4570+blockIndex)]
      app1[Service: api]
      app2[Service: storefront]
      ch -->|s3() reads| ls
      app1 -->|writes events| ch
      app2 -->|writes events| ch
      app1 -->|reads forecasts| ch
    end
```

Both run on the client's `infra` Docker network. Services reference them
internally as `clickhouse:8123` and `localstack:4566`.

## What's in the warehouse by default

Init scripts at `~/.blissful-infra/clients/<client>/clickhouse/init/` run
on first ClickHouse startup. The default script creates:

- A `warehouse` database (the canonical one, plugins write here)
- An example `warehouse.events` table (generic event store; plugins are
  free to create their own tables)

LocalStack init at `~/.blissful-infra/clients/<client>/localstack/init/`
creates a default `<client>-data` S3 bucket.

## Talking to the warehouse, quick examples

### From a Spring Boot service

```kotlin
// Connection details come from env vars injected by service compose.
@Configuration
class WarehouseConfig {
  @Bean
  fun clickhouse(): ClickHouseConnection =
    ClickHouseDriver.getConnection("jdbc:ch://clickhouse:8123/warehouse")
}
```

### From a Python script (jobs, plugins)

```python
import clickhouse_connect
import boto3

# Warehouse query
ch = clickhouse_connect.get_client(host="clickhouse", port=8123, database="warehouse")
result = ch.query("SELECT count() FROM events WHERE source = 'api'")

# Read parquet from LocalStack S3 directly via ClickHouse
ch.query("""
  SELECT * FROM s3(
    'http://localstack:4566/<client>-data/raw/events.parquet',
    'NOSIGN',
    'Parquet'
  )
""")

# Write to LocalStack S3
s3 = boto3.client("s3", endpoint_url="http://localstack:4566",
                  aws_access_key_id="test", aws_secret_access_key="test")
s3.put_object(Bucket="<client>-data", Key="raw/events.parquet", Body=parquet_bytes)
```

### From the host (curl)

```bash
# Insert from CLI (port: 8120 + your client's blockIndex; check `client list`)
curl -X POST 'http://localhost:8120/?database=warehouse' \
  -d "INSERT INTO events (source, event_name, properties)
      VALUES ('curl-test', 'manual_event', '{\"source\":\"laptop\"}')"

# Query
curl 'http://localhost:8120/?query=SELECT+*+FROM+warehouse.events&database=warehouse'
```

## Lakehouse pattern: ClickHouse reading parquet from S3

The two services on the same network make this trivial:

```sql
-- ClickHouse query that reads directly from LocalStack S3
SELECT
    event_name,
    count() AS n
FROM s3(
  'http://localstack:4566/acme-data/year=2026/month=05/events.parquet',
  'NOSIGN',
  'Parquet'
)
WHERE ts >= '2026-05-01'
GROUP BY event_name
ORDER BY n DESC;
```

Same query works against real S3 in production by changing the URL.

## Plugins that consume the warehouse

The `ai-pipeline` plugin (ADR-0010) connects to the **client-level**
ClickHouse + MLflow on the shared infra network instead of co-deploying
its own. When you `service add <client> <service> --plugins ai-pipeline`,
the deps check requires both at the client level, the prompt offers to
enable them if they aren't already.

| Connection | Value (in-network) |
|---|---|
| `MLFLOW_TRACKING_URI` | `http://mlflow:5000` |
| `CLICKHOUSE_HOST` | `clickhouse` |
| `CLICKHOUSE_DB` | `warehouse` (matches the client init script) |

## What the warehouse is NOT (yet)

- **Not a cross-client store.** Each client has its own ClickHouse +
  LocalStack. Cross-client analytics isn't a thing on this platform.
- **Not migration-managed.** Plugins write to whatever tables they want;
  there's no platform-level schema lifecycle. A future plugin contract
  ADR will introduce ownership and migration conventions.
- **Not backed up.** Data lives in Docker volumes. `client remove` deletes
  it. For production, real ClickHouse Cloud / managed object storage.

## Cloud migration

The same code that talks to local `clickhouse:8123` works against managed
ClickHouse (ClickHouse Cloud, Tinybird) by changing the connection
string. Same for LocalStack → real S3 / R2 / GCS, `boto3` works
unchanged when you swap `endpoint_url`.

The blissful-infra cloud-deploy adapter (when shipped) will handle this
automatically per `deploy.target`.

## Related

- [ADR-0008, ClickHouse + LocalStack at client level](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0008-clickhouse-as-client-level-warehouse.md)
- [ADR-0009, Keycloak at client level](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0009-keycloak-as-client-level-iam.md)
- [ADR-0010, Decompose ai-pipeline](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0010-decompose-ai-pipeline-plugin.md)
- [LocalStack blog post](/blog/localstack-aws-locally)
- [Client model](/guides/client-model)
