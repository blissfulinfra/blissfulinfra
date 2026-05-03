# {{PROJECT_NAME}} — AWS Lambda (Python)

This service is a single AWS Lambda function. It runs in a **real AWS Lambda
Python runtime container** locally via LocalStack — same image as production
AWS Lambda.

## Layout

```
{{PROJECT_NAME}}/
├── lambda.yaml        # function manifest (name, runtime, handler, timeout, env)
├── lambda/
│   ├── handler.py     # the handler — your entry point
│   └── requirements.txt
└── docker-compose.yaml
```

## Day-to-day

```bash
# Bring up the service (also starts LocalStack and registers the function)
blissful-infra service up <client> {{PROJECT_NAME}}

# Invoke it
blissful-infra lambda invoke <client> {{PROJECT_NAME}} --payload '{"name":"alice"}'
# → {"statusCode": 200, "body": "{\"message\": \"Hello, alice\", ...}"}

# Edit handler.py, then redeploy (manual — no auto-watch yet)
blissful-infra lambda deploy <client> {{PROJECT_NAME}}

# Tail logs
blissful-infra lambda logs <client> {{PROJECT_NAME}}
```

## What runs locally

- **LocalStack** on the service's per-service `internal` network — emulates
  AWS Lambda + the rest of AWS (S3, DynamoDB, SQS) using the real AWS Lambda
  Docker images.
- **A one-shot deployer container** that runs on `service up`, zips
  `lambda/`, and registers the function with LocalStack via `awslocal lambda
  create-function`.

After deploy, the function is invocable two ways:

- From inside the network: `awslocal lambda invoke --function-name {{PROJECT_NAME}}`
- From the host: `blissful-infra lambda invoke <client> {{PROJECT_NAME}}`

## Cloud deploy

**Not implemented yet.** When the AWS deploy adapter lands (see
[ADR-0007](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0007-aws-lambda-local-via-localstack.md)),
`blissful-infra deploy --target aws` will read the same `lambda.yaml`,
zip the same handler, and upload to real AWS Lambda. No code changes
required.

For now, treat this as a local-only on-ramp.

## Editing the manifest

`lambda.yaml` declares the function's deploy parameters. Run
`blissful-infra lambda deploy` after editing for changes to take effect.

| Field | Notes |
|---|---|
| `runtime` | Pinned to a specific Python version (e.g. `python3.11`). Match what production AWS Lambda supports. |
| `handler` | `<module>.<function>`. With the default layout, `handler.lambda_handler`. |
| `timeout_seconds` | Max 900 (15 min) on real Lambda. LocalStack accepts longer but cap it for portability. |
| `memory_mb` | 128–10240 in 1 MB increments. CPU scales with memory. |
| `environment` | String values only, like real Lambda. Inject these into the function's env. |

## Adding dependencies

1. Add to `lambda/requirements.txt`
2. `blissful-infra lambda deploy <client> {{PROJECT_NAME}}` — the deployer
   will `pip install` into the zip before uploading.

For deps that ship native binaries (numpy, pandas, pillow, cryptography):
LocalStack's Lambda runtime image expects manylinux wheels. The deployer
runs `pip install --platform manylinux2014_x86_64 ...` automatically.

## Limitations of the local runtime

- **No API Gateway routing locally** — invoke via CLI only. HTTP routing
  comes when API Gateway emulation is wired up.
- **No event source mappings** — S3/SQS/DynamoDB triggers work in LocalStack
  but aren't auto-wired by blissful-infra yet.
- **Cold start times differ.** LocalStack is faster than real Lambda. Don't
  rely on local timings for performance work.
