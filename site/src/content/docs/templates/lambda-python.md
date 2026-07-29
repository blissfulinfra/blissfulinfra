---
title: Lambda (Python) template
description: A serverless backend template, one Lambda function, runs on LocalStack locally, ships unchanged to AWS Lambda when the deploy adapter lands.
---

:::caution[Not fully wired up in 2.0]
This template still scaffolds — `blissful-infra service add <name> --type backend --template lambda-python` copies the files. But its **runtime wiring has not been ported to the tenant model**. The standalone `lambda` command was removed in 2.0 along with the client model, and the tenant-era serverless compose shape does not exist yet, so a scaffolded function will not run end to end.

Use `spring-boot` for a backend you intend to run today. This page describes the template's design and stays here for when the port lands.
:::

The `lambda-python` backend template scaffolds a single AWS Lambda function
written in Python. It is designed to run in a real AWS Lambda Python runtime container
locally via [LocalStack](/blog/localstack-aws-locally), the same image as
production AWS Lambda, so the code that runs locally is the code that runs
in AWS.

## When to pick this template

- You want a serverless on-ramp without committing to a long-running container
- Your service is request-response and small enough to fit a single handler
- You're learning Lambda and want fast local iteration without an AWS bill
- You'd ship to AWS Lambda eventually and want code that's portable from day one

For a long-running HTTP backend, pick `spring-boot` instead.

## Scaffold

```bash
blissful-infra service add <service> --type backend --template lambda-python
# Scaffolds the handler and its config. The serverless runtime is not
# wired up in the tenant model yet — see the note above.
```

Resulting layout at `~/.blissful-infra/clients/<client>/<service>/`:

```
<service>/
├── blissful-infra.yaml          # service config (type: service, backend: lambda-python)
├── docker-compose.yaml           # generated; localstack + deployer sidecar
├── lambda.yaml                   # function manifest
├── deploy.sh                     # deployer logic (zips + registers with LocalStack)
├── lambda/
│   ├── handler.py                # the entry point: your code
│   └── requirements.txt          # Python dependencies
└── README.md
```

## What runs

```mermaid
flowchart LR
  subgraph compose[Service compose project]
    ls["LocalStack<br/>(emulates AWS Lambda runtime)"]
    dep["Deployer (one-shot)<br/>zip + register on up"]
    dep -->|awslocal lambda<br/>create-function| ls
  end
  user["You"] -->|invoke| ls
  user -->|edit handler.py| fs[(local files)]
  user -->|deploy| dep
```

The invoke and deploy arrows were the `lambda` command, which no longer exists. A tenant-era replacement has not been designed yet.

On `service up`:

1. LocalStack container starts on the per-service `internal` network
2. Deployer sidecar waits for LocalStack to report ready
3. Deployer reads `lambda.yaml`, zips `lambda/` + deps, calls `awslocal
   lambda create-function`
4. Deployer exits clean. The function is now invocable.

## Manifest reference (`lambda.yaml`)

```yaml
name: hello                       # function name (lowercase alphanumeric + hyphens)
runtime: python3.11               # python3.11 | python3.12 | nodejs20.x | nodejs22.x | java21 | go1.x
handler: handler.lambda_handler   # <module>.<function>
timeout_seconds: 30               # max 900 (15 min, real Lambda limit)
memory_mb: 256                    # 128–10240
environment:
  GREETING: "Hello"               # all values must be strings (real Lambda constraint)
```

The manifest shape is unchanged by the 2.0 cleanup — it describes the function itself, not how blissful-infra wires it up.

## Day-to-day

Scaffolding works:

```bash
blissful-infra service add <service> --type backend --template lambda-python
```

The deploy, invoke and logs steps were the `lambda` command, which was removed in 2.0. There is no current replacement, so a scaffolded function cannot be driven end to end from the CLI. Restoring this needs two things: a tenant-era serverless compose shape, and a command surface to replace `lambda deploy` / `invoke` / `logs`.

## Adding dependencies

Add to `lambda/requirements.txt`, then redeploy:

```text
# lambda/requirements.txt
requests==2.31.0
boto3                  # NOT REQUIRED: included in the AWS Lambda runtime
```

The deployer pip-installs into a temp dir and zips alongside your handler
code. Native deps (numpy, pandas, pillow) install with manylinux wheels by
default, matching what real Lambda expects.

## Bigger handlers

The default `handler.py` is a single-function "hello" greeter. For real apps,
structure as you'd write any Python module:

```
lambda/
├── handler.py           # entry: calls into the rest
├── domain/
│   ├── __init__.py
│   └── greeting.py
├── adapters/
│   ├── __init__.py
│   └── ddb.py
└── requirements.txt
```

The deployer zips the whole `lambda/` dir, so anything importable from
`handler.py` ships.

## Cloud deploy

**Not implemented yet.** When the AWS adapter lands, this same `lambda.yaml`
+ `lambda/` will deploy to real AWS Lambda via `blissful-infra deploy
--target aws`. No code changes required.

For now this is a local-only on-ramp. See
[ADR-0007](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0007-aws-lambda-local-via-localstack.md)
for the planned cloud-deploy story.

## Limitations vs real Lambda

- **No API Gateway routing locally**: invoke via CLI only
- **No event source mappings auto-wired**: S3/SQS/DDB triggers need manual `awslocal` setup
- **Cold-start times are faster locally** than on real AWS, don't optimize for local timings
- **IAM enforcement is off** in LocalStack free tier, permission bugs that fail in production may pass locally
- **No file-watch auto-redeploy**: manual `lambda deploy` after edits

## See also

- [Why LocalStack for AWS local dev](/blog/localstack-aws-locally)
- [`blissful-infra service` reference](/commands/service)
- [Templates overview](/templates/overview)
