# 0007. AWS Lambda backend template runs locally on LocalStack; cloud deploy deferred

- **Status:** Proposed
- **Date:** 2026-05-02
- **Deciders:** @cavanpage

## Context

blissful-infra ships backend templates for `spring-boot`, `fastapi`,
`express`, and `go-chi` — all "long-running container" shapes. None of them
match the serverless / function-shape (`(event) → response`) that AWS
Lambda + Cloudflare Workers + Vercel Functions all use.

Many real projects start serverless. It's the lowest-friction way to take
an idea from zero to running: write a handler, deploy, done. No
provisioning, no Dockerfile, no Spring Boot autoconfig dance. The user
asked for an on-ramp.

We have LocalStack already in the stack as a service-level plugin. Its
free tier supports Lambda emulation in a real AWS Lambda Docker runtime —
the same image as production. So we have most of the pieces; we need to
glue them into a first-class backend choice.

A complementary question — local now, cloud later? — was answered in the
conversation: focus on local dev first. The cloud-deploy adapter for AWS
Lambda is documented as future work but **not implemented in this scope**.
The reasoning is honest: the existing deploy adapters (`packages/cli/src/deploy/`)
have no real coverage, and shipping an untested AWS deploy path would
mislead users into thinking it works.

## Decision

Add `lambda-python` as a new **backend template choice**, peer to
`spring-boot` etc. Local execution runs on LocalStack inside the service's
unified Compose project. Deploy to real AWS is **deferred** — documented
as future work in this ADR's "Risks / follow-ups" section.

### Service-add flow

```bash
blissful-infra service add dev hello --backend lambda-python
```

Scaffolds at `~/.blissful-infra/clients/dev/hello/`:

```
hello/
├── blissful-infra.yaml          # service config (type: service, backend: lambda-python)
├── docker-compose.yaml           # joins client infra; pulls in LocalStack as required dep
├── lambda.yaml                   # the manifest — function name, runtime, handler entry, env, role
└── lambda/
    ├── handler.py
    ├── requirements.txt
    └── README.md
```

`lambda-python` is **not a normal backend** — there's no long-running
container running the user's code. Instead, the service compose includes
LocalStack (as a required component, not a plugin) plus a one-shot
"deployer" sidecar that registers the function with LocalStack on
service up.

### Manifest

```yaml
# lambda.yaml
name: hello
runtime: python3.11
handler: handler.lambda_handler
timeout_seconds: 30
memory_mb: 256
environment:
  GREETING: hello
  # ...
```

This file is the source of truth for the function's deploy parameters.
Local deploy reads from it; future cloud deploy will read from the same
file. No drift between local and cloud configurations.

### CLI surface

```bash
# Re-deploy after editing handler.py (manual; no file watching for now)
blissful-infra lambda deploy <client> <service>

# Invoke locally
blissful-infra lambda invoke <client> <service> [--payload '{"key":"value"}']

# Tail logs (CloudWatch logs emulated by LocalStack)
blissful-infra lambda logs <client> <service> [--last]
```

### What `service up` does for a `lambda-python` service

1. LocalStack container starts (per-service, on the service's `internal`
   network).
2. Init scripts run — buckets, queues, etc. (existing LocalStack plugin
   behavior).
3. Deployer sidecar waits for LocalStack `_localstack/health` to report
   ready.
4. Deployer zips `lambda/` into `function.zip`, calls `awslocal lambda
   create-function` (or `update-function-code` if it exists already).
5. Deployer exits with code 0. Function is now invocable via
   `awslocal lambda invoke` against `localstack:4566` from inside the
   network, or via the new `lambda invoke` CLI from outside.

### What's intentionally NOT included

- **Other runtimes.** Python first. `lambda-node`, `lambda-go`, `lambda-rust`
  follow the same pattern but ship in separate ADRs/PRs.
- **API Gateway routing.** Calling lambdas from a browser via HTTP requires
  API Gateway emulation. LocalStack supports it but it adds significant
  complexity. Initial release: invocation via CLI only.
- **Event source mappings.** S3 → Lambda triggers, SQS → Lambda triggers,
  DynamoDB streams. All possible in LocalStack, all out of scope for v1.
- **Hot reload on file save.** Initial: explicit `lambda deploy` after
  edits. Future: chokidar-watch + auto-redeploy.
- **Real AWS deploy adapter.** Documented as the next ADR (or extension
  of this one) once real AWS testing is feasible.
- **Cloudflare Workers / Vercel Edge / GCP Cloud Functions backends.**
  Each gets its own ADR when prioritized.

## Consequences

### Positive

- **Real serverless on-ramp.** Users can write `(event) → response`
  handlers and run them in a real AWS Lambda runtime locally.
- **Code that runs locally runs in real AWS.** LocalStack uses the same
  Lambda Docker images. No code changes needed when deploy lands.
- **Manifest-driven.** `lambda.yaml` is the single source of truth for
  function configuration. Same file feeds local and (future) cloud deploy.
- **Fits the existing client model.** A `lambda-python` service is just a
  service with a different backend choice — same client-level
  infrastructure (Postgres, Kafka, observability) is available.
- **Free.** No AWS account needed to start.

### Negative

- **Local-only is honest about scope but limits real-world value.**
  A user who wants to ship to production has to wait for the deploy
  adapter or hand-roll the upload (zip + `aws lambda update-function-code`).
- **No HTTP routing locally.** Can't hit `https://hello.dev.localhost` and
  get a Lambda response without API Gateway emulation. CLI invoke only.
- **LocalStack is now load-bearing for a backend type.** If LocalStack
  changes its Lambda emulation behavior, our local lambda dev breaks.
  Mitigated: pin LocalStack version in compose.
- **Deployer sidecar adds startup time.** ~5-10 seconds for zip + register
  on each `service up`. Acceptable for dev; would be unacceptable in CI,
  but CI for lambda services is a separate concern.

### Risks / follow-ups

- **Cloud deploy adapter is the obvious gap.** When ready: zip the
  `lambda/` dir, call `aws lambda create-function` against real AWS,
  return the function ARN. ~2-3 hr of work. Should be its own ADR
  capturing IAM role provisioning (the gnarly part), region selection,
  and rollback semantics.
- **Multiple-function services.** Real apps often have 5-20 lambdas in
  one service. The current shape ("one service = one function") doesn't
  fit. Either: extend manifest to declare multiple functions, OR
  recommend "one service per function" (loses some shared context).
  Defer until a user asks.
- **Cold-start simulation.** Real Lambda has 100-1000ms cold starts.
  LocalStack's emulation may be faster. Worth flagging in docs so users
  don't write code that depends on local timings.
- **Layer support.** AWS Lambda Layers (shared deps) aren't supported in
  LocalStack free tier reliably. Document as a Pro-tier-or-real-AWS
  feature.

## Alternatives considered

- **AWS SAM Local instead of LocalStack.** SAM Local is AWS's official
  Lambda local emulator. It's actually simpler than LocalStack for pure
  Lambda dev. **Rejected** because: (a) we already have LocalStack, (b)
  SAM Local doesn't emulate the rest of AWS (S3, DynamoDB, SQS), so users
  who want lambda + storage need both tools, (c) SAM Local doesn't
  integrate with our client-model unified Compose project.
- **Run the handler as a long-running Python container.** Wrap the
  handler in FastAPI/Flask, never use a real Lambda runtime locally.
  **Rejected** because the whole point is to *be* serverless — different
  cold-start behavior, different event shapes, different deploy story.
  This would be a fake.
- **Skip LocalStack, hand-roll Lambda emulation.** Use AWS's
  `aws-lambda-runtime-interface-emulator` directly. Lower-level but
  doable. **Rejected** because LocalStack already wraps it cleanly and
  gives us the rest of AWS for free.
- **Make `lambda-python` a plugin instead of a backend.** A service with
  no backend, plus a "lambda" plugin. **Rejected** because backend type
  is the right axis — it's what determines the runtime shape, deploy
  target, and template scaffolding.
- **Multiple lambdas in one service.** A `lambda-python` service holding
  N functions. **Deferred.** Start with one-function-per-service. If
  users need multi-function services later, extend the manifest. Don't
  over-engineer.

## References

- [LocalStack Lambda docs](https://docs.localstack.cloud/user-guide/aws/lambda/)
- ADR-0002 (per-client isolation) — clients still own the network
- ADR-0003 (unified compose project) — service compose merges into client compose
- [specs/cloud-deploy.md](../../specs/cloud-deploy.md) — broader cloud-deploy strategy
  (this ADR is a slice of it focused on Lambda local; cloud lambda deploy is
  the next slice)
- Conversation log 2026-05-02: "is there a way to simulate lambda locally?"
