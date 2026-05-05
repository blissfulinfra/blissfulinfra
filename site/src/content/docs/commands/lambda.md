---
title: blissful-infra lambda
description: Manage AWS Lambda functions running locally on LocalStack, deploy, invoke, tail logs.
---

`blissful-infra lambda` manages AWS Lambda functions inside services that
were scaffolded with the `lambda-python` backend (see
[the lambda-python template](/templates/lambda-python)). Functions run in
LocalStack's emulated AWS Lambda runtime, the same Docker images real AWS
Lambda uses.

:::caution[Local only]
Cloud deploy to real AWS Lambda is **not yet implemented**. See
[ADR-0007](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0007-aws-lambda-local-via-localstack.md)
for the deploy-adapter follow-up.
:::

## Subcommands

| Subcommand | Purpose |
|---|---|
| `lambda deploy <client> <service>` | Re-package and deploy the function to the service's LocalStack |
| `lambda invoke <client> <service> [--payload]` | Invoke the function with a JSON event |
| `lambda logs <client> <service> [--last]` | Tail Lambda logs (CloudWatch logs emulated by LocalStack) |

## Typical flow

```bash
# Scaffold a lambda service (LocalStack auto-included)
blissful-infra service add dev hello --backend lambda-python

# `service up` triggers an initial deploy automatically (the deployer
# sidecar runs once on first up). For subsequent edits:
vim ~/.blissful-infra/clients/dev/hello/lambda/handler.py

blissful-infra lambda deploy dev hello
# → repackages handler.py + requirements.txt, re-registers with LocalStack

blissful-infra lambda invoke dev hello --payload '{"name":"alice"}'
# Response:
# {
#   "statusCode": 200,
#   "body": "{\"message\": \"Hello, alice\", \"function\": \"hello\"}"
# }
```

## `lambda deploy`

```bash
blissful-infra lambda deploy <client> <service>
```

Re-runs the deployer sidecar against the service's LocalStack. The deployer:

1. Reads `lambda.yaml` for runtime, handler, timeout, memory, env
2. Pip-installs `lambda/requirements.txt` into a temp dir
3. Zips `lambda/` + deps into a deployment package
4. Calls `awslocal lambda update-function-code` (or `create-function` if
   the function doesn't exist yet)
5. Updates the function configuration to match the manifest

Takes 5-10 seconds typically. The function is hot-redeployed without
restarting LocalStack.

## `lambda invoke`

```bash
blissful-infra lambda invoke <client> <service> [--payload <json>]
```

| Flag | Description |
|---|---|
| `-p, --payload <json>` | JSON event payload. Default: `{}`. |

Validates JSON before sending (better error than awslocal's). Prints the
response body and Lambda metadata (StatusCode, ExecutedVersion).

```bash
blissful-infra lambda invoke dev hello -p '{"name":"world","count":3}'
```

## `lambda logs`

```bash
blissful-infra lambda logs <client> <service> [--last]
```

| Flag | Description |
|---|---|
| `--last` | Show only the most recent invocation's logs and exit (no follow) |

Default behavior: tails the function's CloudWatch log group
(`/aws/lambda/<service>`) and follows new events. `Ctrl+C` exits.

`--last` is convenient for quick checks: invoke, then `logs --last` to see
what the function printed.

## Where things live

| Resource | Location |
|---|---|
| Handler source | `~/.blissful-infra/clients/<client>/<service>/lambda/handler.py` |
| Manifest | `~/.blissful-infra/clients/<client>/<service>/lambda.yaml` |
| Deploy script | `~/.blissful-infra/clients/<client>/<service>/deploy.sh` |
| LocalStack container | `<client>-<service>-localstack` |
| Function inside LocalStack | `arn:aws:lambda:us-east-1:000000000000:function:<service>` |

## Limitations

- **No HTTP routing locally.** API Gateway emulation is not yet wired up;
  invoke via CLI only. Real-AWS deployments will set up API Gateway as
  part of the deploy adapter.
- **No event source mappings.** S3-triggered, SQS-triggered, and DynamoDB
  Streams-triggered lambdas all work in LocalStack but require manual
  wiring via `awslocal` for now.
- **No file-watching auto-deploy.** Edit handler.py, then run `lambda
  deploy` manually. Auto-watch is queued.
- **Cold-start times differ from real Lambda.** LocalStack is faster.
  Don't make timing assumptions based on local runs.

## See also

- [Lambda Python template](/templates/lambda-python)
- [Why LocalStack for AWS local dev](/blog/localstack-aws-locally)
- [ADR-0007, Lambda backend template + LocalStack runtime](https://github.com/cavanpage/blissful-infra/blob/main/docs/adr/0007-aws-lambda-local-via-localstack.md)
