"""
{{PROJECT_NAME}} — AWS Lambda handler.

This file is the entry point for your Lambda. It runs in a real AWS Lambda
runtime container locally (via LocalStack) and ships unchanged to AWS Lambda
in the cloud (when the deploy adapter lands).

The handler signature is the standard Lambda Python contract:
    def lambda_handler(event: dict, context: LambdaContext) -> Any
"""
import json
import os


def lambda_handler(event: dict, context) -> dict:
    """Default greeter handler.

    Returns a JSON response shaped for either direct invocation or API Gateway
    proxy integration. Deploy with `blissful-infra lambda deploy <client> {{PROJECT_NAME}}`,
    invoke with `blissful-infra lambda invoke <client> {{PROJECT_NAME}}`.
    """
    name = event.get("name", "world")
    greeting = os.environ.get("GREETING", "Hello")
    body = {"message": f"{greeting}, {name}", "function": "{{PROJECT_NAME}}"}

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
