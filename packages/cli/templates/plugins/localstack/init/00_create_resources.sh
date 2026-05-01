#!/bin/bash
# LocalStack init script — runs automatically when LocalStack is ready.
# Add AWS resource creation commands here. The awslocal CLI is pre-installed
# and pre-configured to talk to LocalStack (no credentials/endpoint needed).

set -e

echo "Creating LocalStack resources for {{PROJECT_NAME}}..."

# S3 bucket
awslocal s3 mb s3://{{PROJECT_NAME}}-assets
awslocal s3api put-bucket-cors \
  --bucket {{PROJECT_NAME}}-assets \
  --cors-configuration '{"CORSRules":[{"AllowedMethods":["GET","PUT","POST"],"AllowedOrigins":["*"],"AllowedHeaders":["*"]}]}'

# SQS queue (standard + dead-letter)
awslocal sqs create-queue --queue-name {{PROJECT_NAME}}-events-dlq
awslocal sqs create-queue \
  --queue-name {{PROJECT_NAME}}-events \
  --attributes RedrivePolicy='{"deadLetterTargetArn":"arn:aws:sqs:us-east-1:000000000000:{{PROJECT_NAME}}-events-dlq","maxReceiveCount":"5"}'

# DynamoDB table (single-table design, PAY_PER_REQUEST)
awslocal dynamodb create-table \
  --table-name {{PROJECT_NAME}}-table \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

# SNS topic
awslocal sns create-topic --name {{PROJECT_NAME}}-notifications

echo "LocalStack resources created."
