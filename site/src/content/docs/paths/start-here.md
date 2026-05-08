---
title: Choosing a tech stack
description: A plain-language breakdown of backend languages, frontend frameworks, database types, and infrastructure patterns — tradeoffs, not hype — so you can make an informed choice instead of a random one.
---

Every technology choice involves a tradeoff. The goal of this page is not to tell you which stack is best — there is no universal answer — but to give you enough signal to make a decision you can defend, and to stop researching and start building.

---

## Backend languages

The backend language shapes your job market, your runtime characteristics, and how much the language itself gets in the way while you're learning the infrastructure layer beneath it.

### Java / Kotlin

The JVM is the dominant runtime in enterprise software — finance, healthcare, e-commerce, large tech. Java has been there since the 90s. Kotlin is JVM-compatible but modern: concise, null-safe, and the preferred language for new JVM projects.

**Strengths:** Mature ecosystem, excellent tooling (IntelliJ, Gradle), strong typing catches mistakes at compile time, huge job market, Spring Boot is a battle-tested framework for HTTP APIs and event-driven services.

**Tradeoffs:** Verbose compared to Python or Go. JVM startup time is slow (though GraalVM native images are improving this). The learning curve includes the language, the framework, and the build system simultaneously.

**Choose if:** You want the widest possible enterprise job market, or you're building services that need to run reliably at scale for years.

---

### Python

Python is the language of data science, machine learning, and scripting. On the web side, FastAPI and Django are common. Its syntax prioritizes readability over ceremony.

**Strengths:** Fastest to write, dominant in ML/data engineering, enormous library ecosystem (NumPy, Pandas, PyTorch, scikit-learn), easy to pick up as a first language.

**Tradeoffs:** Dynamically typed — bugs that a compiler would catch in Java surface at runtime instead. The GIL (Global Interpreter Lock) limits true CPU parallelism in CPython. Slower at runtime than compiled languages. Managing dependencies and environments (pip, venv, conda) is notorious friction.

**Choose if:** You want to work in data engineering, ML, or scientific computing. Also a good choice if you want to move fast on a prototype and care less about compile-time safety.

---

### Go

Go was designed at Google to write infrastructure software — fast to compile, easy to deploy (single binary), excellent concurrency primitives (goroutines and channels). Kubernetes, Docker, Terraform, and most of the cloud-native tooling is written in Go.

**Strengths:** Extremely fast startup (good for serverless and CLIs), statically typed, simple language spec (small surface area), great standard library, excellent for high-concurrency network services.

**Tradeoffs:** The language is deliberately minimal — no generics until Go 1.18, less expressive than Python or Kotlin for certain patterns. Error handling is explicit and repetitive (`if err != nil`). Smaller ecosystem than Java or Python for web frameworks.

**Choose if:** You want to work on infrastructure, platform engineering, CLIs, or services where startup time and resource usage matter. Strong signal for DevOps-adjacent roles.

---

### TypeScript / Node.js

JavaScript on the backend. The main advantage is a shared language with the frontend: one language across the full stack. TypeScript adds static types on top.

**Strengths:** Unified language with frontend, enormous npm ecosystem, non-blocking I/O handles concurrent connections well, TypeScript tooling has improved significantly, good for real-time apps (WebSockets, streaming).

**Tradeoffs:** Single-threaded event loop — CPU-bound work blocks everything. Type safety is opt-in and can be worked around; the ecosystem is inconsistent in quality. Dependency trees are notoriously large. The language has sharp edges inherited from JavaScript's history.

**Choose if:** You're coming from frontend development and want to stay in one language, or you're building real-time/I/O-heavy services (chat, streaming, notifications).

---

### Rust

Rust is a systems programming language with memory safety guarantees without a garbage collector. It is blazingly fast and prevents entire classes of memory bugs at compile time.

**Strengths:** Performance comparable to C/C++, no GC pauses, memory safety, excellent for WebAssembly, CLIs, and systems software.

**Tradeoffs:** The steepest learning curve of any mainstream language (the borrow checker). Slow compile times. Not a common backend choice for typical web APIs yet, though frameworks like Axum are gaining traction.

**Choose if:** You want systems programming, game development, WebAssembly, or you specifically want to develop the skill of writing safe, high-performance software. Not the pragmatic first choice for a web backend role.

---

### C# / .NET

Microsoft's enterprise stack. ASP.NET Core is a modern, performant web framework. C# is similar in feel to Java with some Kotlin-like improvements.

**Strengths:** First-class Windows ecosystem, strong enterprise presence, used heavily in game development (Unity), modern C# is a solid language, good tooling (Visual Studio, Rider).

**Tradeoffs:** Strongest in Microsoft-ecosystem shops; less common at startups and in cloud-native environments.

**Choose if:** You're targeting enterprise Microsoft-stack companies or game development.

---

## Frontend

The frontend is the layer users directly interact with. Most production web frontends use one of a few frameworks built on top of JavaScript (or TypeScript). The choice affects hiring pool, learning curve, and what patterns you'll encounter professionally.

### React

The dominant frontend library. Built by Meta, React introduced the component model and virtual DOM that shaped how the industry thinks about UI. It is not a full framework — routing, state management, and data fetching require additional choices.

**Strengths:** By far the largest job market. Huge ecosystem. Strong community. Component model is composable and easy to reason about once internalized.

**Tradeoffs:** Not opinionated — you have to make and maintain ecosystem choices (React Router, Zustand, TanStack Query, etc.). JSX syntax is unfamiliar at first. The ecosystem moves fast and older tutorials go stale.

**Choose if:** You want the broadest frontend job market. Default choice unless you have a specific reason to choose otherwise.

---

### Vue

A progressive framework — you can add it to an existing page incrementally or build a full SPA. Comes with more opinions than React: single-file components bundle HTML, CSS, and JavaScript together.

**Strengths:** Gentler learning curve than React. More opinionated (less ecosystem fatigue). Strong in the Asian tech market.

**Tradeoffs:** Smaller job market than React in North America and Europe. The ecosystem is smaller. Two competing component APIs (Options and Composition) can be confusing early on.

**Choose if:** You find React overwhelming and want something more structured, or if the companies you're targeting use Vue.

---

### Angular

A complete, opinionated framework from Google. Includes routing, forms, HTTP, dependency injection, and more out of the box. TypeScript-first from day one.

**Strengths:** Everything is built in — no ecosystem decision fatigue. Strong in enterprise and government applications where long-term stability matters. Opinionated structure scales to large teams.

**Tradeoffs:** The steepest learning curve of the three. Concepts like modules, decorators, and dependency injection are unfamiliar to newcomers. Heavier boilerplate. Less common at startups.

**Choose if:** You're targeting large enterprise companies or have a background that makes the structured patterns familiar (Java background often maps well).

---

### Svelte / SvelteKit

Svelte is a compile-time framework — instead of running a virtual DOM in the browser, it compiles your components to efficient imperative DOM updates at build time. Results in smaller bundles and less runtime overhead.

**Strengths:** Simple syntax, excellent performance, small bundle size, SvelteKit is a well-designed meta-framework.

**Tradeoffs:** Smaller ecosystem and job market than React or Vue. Fewer third-party component libraries. Less established in production at large scale.

**Choose if:** You're building a performance-sensitive app or side project and want a modern developer experience without the React ecosystem overhead.

---

### Meta-frameworks

All of the above are component libraries or frameworks. Meta-frameworks add routing, server-side rendering, and deployment conventions on top:

| Meta-framework | Based on | Best for |
|---|---|---|
| Next.js | React | Full-stack React apps, SSR, static sites |
| Remix | React | Data-loading, progressive enhancement |
| Nuxt | Vue | Full-stack Vue apps |
| SvelteKit | Svelte | Full-stack Svelte apps |
| Astro | Framework-agnostic | Content-heavy sites, minimal JavaScript |

For most new projects, Next.js is the default choice if you're on React. It handles routing, server components, and deployment targets out of the box.

---

## Databases

Database choice is one of the highest-leverage decisions in a system's design. Getting it wrong is expensive to fix later.

### Relational databases

Relational databases store data in tables with defined schemas. Relationships between tables are expressed as foreign keys. SQL is the query language. ACID transactions (Atomicity, Consistency, Isolation, Durability) guarantee data integrity.

**Use relational when:** Your data has clear structure, you need transactions across multiple entities, or you need complex queries with joins and aggregations.

#### PostgreSQL

The default choice. ACID-compliant, rich type system (JSON, arrays, full-text search, geospatial via PostGIS), mature, runs everywhere, strong community. Handles both OLTP (transactional) and moderate analytics workloads.

**Default choice for almost every application that needs a relational database.**

**Cloud equivalent:** Amazon RDS (PostgreSQL or Aurora PostgreSQL), Google Cloud SQL, Azure Database for PostgreSQL. Aurora PostgreSQL is AWS's re-engineered storage layer on top of the Postgres wire protocol — faster for read-heavy workloads, higher cost, slightly different behavior at the edges.

#### MySQL / MariaDB

Slightly simpler than Postgres, widely available on shared hosting. MySQL is Oracle-owned; MariaDB is the community fork. Both are production-grade. Fewer advanced features than Postgres (weaker JSON support, fewer index types).

**Choose if:** You're on a hosting environment that defaults to MySQL or the team already uses it.

**Cloud equivalent:** Amazon RDS (MySQL), Amazon Aurora MySQL, Google Cloud SQL (MySQL), Azure Database for MySQL.

#### SQLite

An embedded database — a single file, no server process required. Excellent for local development, testing, mobile apps, and small single-user tools. Not designed for concurrent writes from multiple processes.

**Use for:** Local dev, tests, CLI tools, mobile apps. Not for web servers with concurrent users.

---

### Non-relational databases

Non-relational (NoSQL) databases trade some relational guarantees (joins, full ACID across tables) for flexibility, scale, or performance in specific access patterns.

The term "NoSQL" covers very different tools. The right choice depends on what kind of data you have and how you access it.

#### Document stores (MongoDB)

Stores JSON-like documents. Schema is flexible — different documents in the same collection can have different fields. Good for hierarchical data (user profiles, product catalogs, content).

**Strengths:** Flexible schema useful early in development when the data model is evolving. Naturally maps to the objects your application works with. ACID within a single document.

**Tradeoffs:** No joins across collections (you either embed data or do application-level joins). Schema flexibility can become schema chaos without discipline. Multi-document transactions exist but are more complex. Querying across nested fields gets awkward.

**Choose if:** Your data is genuinely hierarchical and document-shaped, or your schema is evolving rapidly early in development. Reconsider if you find yourself wanting JOINs — that's a signal your data is relational.

**Cloud equivalent:** MongoDB Atlas (first-party hosted, runs on AWS/GCP/Azure). Amazon DocumentDB is MongoDB-compatible but is not the same engine — it implements a subset of the MongoDB API on a completely different storage layer. Verify behavior compatibility before treating them as interchangeable.

#### Key-value stores (Redis)

Stores values indexed by a key. Extremely fast because it operates in memory. Supports strings, lists, sets, sorted sets, hashes, and streams.

**Strengths:** Sub-millisecond read and write. Excellent for caching, session storage, rate limiting, pub/sub messaging, and queues.

**Tradeoffs:** Data must fit in memory (with caveats). Not designed as a primary data store for business data — data can be lost on restart unless persistence is configured. Not suited for complex queries.

**Use as:** A cache layer alongside a primary database, not as a standalone database.

**Cloud equivalent:** Amazon ElastiCache for Redis, Google Memorystore, Azure Cache for Redis.

#### DynamoDB

Amazon's fully managed key-value and document database. There is no open-source self-hosted equivalent — DynamoDB is an AWS-only service. LocalStack emulates the full DynamoDB API locally, so you can develop and test against it without incurring AWS costs.

The access model is fundamentally different from relational databases. You design your entire data model around access patterns upfront, using a partition key (and optional sort key) to determine how data is stored and retrieved. The widely used "single-table design" pattern collapses all entity types into one table with carefully chosen key structures.

**Strengths:** Fully managed with zero infrastructure to operate. Serverless billing — pay per read/write request unit or provision throughput in advance. Scales to any volume without capacity planning. Global tables replicate data across regions automatically. DynamoDB Streams emit a change feed that pairs naturally with Lambda for event-driven patterns. Millisecond latency at any scale.

**Tradeoffs:** The data model must be designed around known access patterns — ad-hoc queries and flexible filtering are limited and expensive compared to SQL. No joins. Changing your access patterns later requires rethinking and migrating your key structure. The single-table design pattern is a significant mental shift from relational thinking and has a real learning curve.

**Choose if:** You are building on AWS, your access patterns are well understood upfront, and you want a database that requires zero operational attention. Pairs especially well with Lambda: both bill per-invocation, both scale to zero, both are managed.

**Cloud equivalent:** AWS-native. No direct equivalent on GCP or Azure, though Google Firestore and Azure Cosmos DB (Table API) cover similar use cases.

#### Columnar / analytical (ClickHouse, BigQuery, Redshift)

Stores data by column rather than by row, enabling extremely fast aggregation queries over large datasets. Purpose-built for OLAP (online analytical processing) workloads.

**Strengths:** Orders of magnitude faster than Postgres for analytical queries (aggregations, GROUP BY, time-series analysis) on large datasets. ClickHouse is open-source and fast even on a laptop.

**Tradeoffs:** Not designed for OLTP. Individual row inserts and updates are slow. Not a replacement for Postgres for transactional data.

**Use for:** Event analytics, metrics storage, user behavior data, business intelligence queries. Often deployed alongside a Postgres primary store, with data flowing in from a Kafka pipeline.

**Cloud equivalent:** Amazon Redshift (columnar data warehouse), Google BigQuery (serverless, pay-per-query), Snowflake (multi-cloud). ClickHouse Cloud is the hosted version of the OSS engine. BigQuery and Redshift are the dominant choices in AWS/GCP shops.

#### Wide-column (Cassandra)

A distributed database designed for extremely high write throughput and horizontal scalability. Data is organized by partition key and cluster key. No joins. Queries are designed around known access patterns.

**Strengths:** Linear horizontal scaling, no single point of failure, tunable consistency, handles massive write volumes (think IoT sensor data, click streams).

**Tradeoffs:** No JOINs, no ad-hoc queries, eventual consistency by default, data modeling is non-trivial, operational complexity. Brings genuine value only at significant scale.

**Choose if:** You need to write millions of events per second at global scale. Overkill for most applications.

**Cloud equivalent:** Amazon Keyspaces (Cassandra-compatible managed service), Azure Cosmos DB (Cassandra API).

#### Search (Elasticsearch / OpenSearch)

Full-text search, fuzzy matching, faceted filtering, and aggregations at scale. Commonly used alongside a primary database — data is indexed into Elasticsearch for search, then retrieved in full from the source database.

**Strengths:** Excellent full-text search (relevance ranking, stemming, synonyms), fast aggregations, good for log analytics (the ELK stack: Elasticsearch + Logstash + Kibana).

**Tradeoffs:** Operationally heavy, not a primary data store, schema changes are painful (requires reindexing), consistency model is eventual.

**Use for:** Application search features, log analytics. Not as a primary database.

**Cloud equivalent:** Amazon OpenSearch Service (AWS's managed fork of Elasticsearch), Elastic Cloud (first-party hosted). Note: Amazon OpenSearch and Elasticsearch are not the same engine — they diverged after AWS forked the project. API compatibility is high but not identical.

#### Time-series (TimescaleDB, InfluxDB)

Databases optimized for time-stamped data: metrics, events, sensor readings, financial ticks. TimescaleDB is a Postgres extension — you use SQL, and it handles time-series partitioning and compression automatically.

**Strengths:** Excellent compression, fast time-range queries, purpose-built retention policies.

**Choose if:** Your primary workload is append-only time-stamped data at volume (metrics, IoT, financial feeds).

**Cloud equivalent:** Amazon Timestream, InfluxDB Cloud, Google Cloud Bigtable (for extreme scale).

---

### Picking a database: the short version

1. **Start with PostgreSQL.** It handles most workloads well and you can always add more later.
2. **Add Redis** when you need caching, sessions, or a simple queue.
3. **Add a columnar store** (ClickHouse or BigQuery) when your analytics queries are slowing down Postgres.
4. **Add Elasticsearch / OpenSearch** when you need full-text search with relevance ranking.
5. **MongoDB** is reasonable when your schema is genuinely document-shaped and evolving. Reconsider if you find yourself wanting joins.
6. **DynamoDB** if you are building on AWS and your access patterns are fixed — it eliminates all operational overhead at the cost of data modeling flexibility.
7. **Cassandra** only at genuine scale.

---

## Infrastructure and architecture patterns

How you deploy and run your application is a separate set of choices from what language and database you use.

### Monolith

A single deployable unit containing all the application's functionality. One codebase, one build artifact, one running process.

**Strengths:** Simple to develop, test, and deploy. Straightforward to reason about — you can trace a request from entry to exit without crossing a network boundary. Most applications start here and stay here for a long time.

**Tradeoffs:** As the codebase grows, poor internal boundaries lead to tight coupling. Scaling means scaling everything, even if only one component is under load. A single large deployment is a bigger blast radius for bugs.

**Default choice for most applications.** The word "monolith" is often used pejoratively, but most successful products ran as monoliths for years. Shopify, Stack Overflow, and Basecamp have all run and shipped at scale as monoliths.

---

### Microservices

The application is split into independently deployable services, each owning a bounded domain (e.g., users, orders, payments). Services communicate over the network (HTTP/REST, gRPC, or a message broker).

**Strengths:** Independent scaling per service. Teams can own and deploy their service without coordinating with other teams. Technology diversity — each service can use the right tool for its job.

**Tradeoffs:** Distributed systems are hard. Network calls fail in ways that in-process function calls don't. You now have N services to deploy, monitor, and secure. Data consistency across services requires explicit design (eventual consistency, sagas). Debugging requires distributed tracing. The operational overhead is real and front-loaded.

**Choose if:** You have multiple teams working in parallel who need to ship independently, and you have the platform maturity to operate multiple services. For most early-stage products, microservices is premature complexity.

---

### Serverless

Functions-as-a-service: you deploy code, the provider handles servers, scaling, and the runtime. AWS Lambda, Google Cloud Functions, Cloudflare Workers.

**Strengths:** No infrastructure to manage. Scales to zero (no cost when idle). Scales automatically under load. Billing is per invocation, not per provisioned server.

**Tradeoffs:** Cold starts add latency when a function hasn't been invoked recently (though providers have improved this). Functions are stateless — no in-memory state between invocations. Long-running processes are not a good fit. Database connection pooling is a real problem (each function invocation may open a new connection). Debugging is harder — distributed tracing is essential. Vendor lock-in is high.

**Choose if:** Your workload is naturally event-driven and intermittent (image processing, webhook handlers, scheduled jobs, APIs with spiky traffic). Not a good fit for latency-sensitive or long-running workloads.

---

### Kubernetes

A container orchestration platform. You describe the desired state of your application (how many replicas, what container image, what resources) and Kubernetes makes it so. Handles scheduling, health checking, restarts, rolling deployments, and service discovery.

**Strengths:** Declarative infrastructure — the cluster state is defined in YAML files you can version-control. Self-healing (restarts failed containers). Horizontal pod autoscaling. A large ecosystem of tooling (Helm, ArgoCD, Istio, etc.).

**Tradeoffs:** Significant operational complexity. Running a real Kubernetes cluster (not managed) requires genuine infrastructure expertise. Even managed Kubernetes (EKS, GKE, AKS) has a steep learning curve. Most small teams don't need it and will be slowed down by it.

**Choose if:** You have multiple services with different scaling profiles, a team large enough to maintain the cluster, or a compliance/operational requirement that mandates it. Avoid it as a first deployment target.

---

### Edge compute

Code running close to the user in distributed CDN nodes around the world. Cloudflare Workers, Vercel Edge Functions, Deno Deploy, Fastly Compute.

**Strengths:** Very low latency for geographically distributed users. Global deployment in one command. No cold starts on Cloudflare Workers.

**Tradeoffs:** Limited compute and memory per invocation. No stateful patterns (no persistent connections, no filesystem). Runtime is often a subset of Node.js, not full Node — some npm packages don't work. Database connections are constrained (edge nodes can't hold long-lived DB connections; you route through a connection pooler or an edge-compatible data layer like Cloudflare D1 or PlanetScale HTTP API).

**Choose if:** You're building globally distributed APIs, static sites with edge personalization, or A/B testing logic. Not a good fit for long-running or stateful workloads.

---

### Event-driven architecture

Services communicate by publishing and consuming events on a message broker rather than calling each other directly over HTTP. Kafka, RabbitMQ, and cloud-managed queues (SQS, Pub/Sub) are the common choices.

**Strengths:** Decouples producers from consumers — neither knows about the other. Events are durable (Kafka retains the log). Multiple consumers can process the same event independently. Good for workflows that need to fan out to multiple downstream systems.

**Tradeoffs:** Harder to reason about than a direct function call. Debugging requires tracing events across system boundaries. Eventual consistency — a downstream consumer may be behind. Kafka in particular has operational weight.

**Kafka vs. RabbitMQ vs. managed queues:**

| | Kafka | RabbitMQ | SQS / Cloud queues |
|---|---|---|---|
| Model | Durable log, consumer reads at its own pace | Push-based broker, messages are consumed and deleted | Managed queue, messages deleted after consumption |
| Replay | Yes — consumers can rewind | No | No |
| Throughput | Very high | Moderate | Moderate |
| Operational weight | High | Moderate | None (managed) |
| Best for | Event streams, audit logs, data pipelines | Task queues, RPC patterns | Simple async task queues with no ops overhead |

---

## Summary: the decisions and their order

When starting a new project, make these decisions in roughly this order:

1. **Language** — pick one you know, or pick one that matches where you want to work.
2. **Relational database first** — PostgreSQL unless there's a specific reason not to.
3. **Add caching when you need it** — Redis as a second layer.
4. **Architecture based on team size** — monolith until you have multiple teams shipping independently.
5. **Deployment target based on scale** — single VM or managed container service first. Kubernetes when you have genuine multi-service operational complexity.
6. **Event-driven when decoupling matters** — add a message broker when you need to decouple producers from consumers, not as a default pattern.

The stacks that combine well at the start: a JVM or Python backend, PostgreSQL, Redis, and a simple container deployment. That covers the vast majority of production workloads and maps to the most common patterns you'll encounter in a professional environment.
