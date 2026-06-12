#!/bin/bash
# Create or update the leaderboard-updater Lambda in AWS
# Prerequisites: build-lambda.sh must run first; AWS CLI configured; DynamoDB Streams enabled

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
TABLE="bughunt-main"
FUNCTION_NAME="bughunt-leaderboard-updater"
LAMBDA_DIR="$(cd "$(dirname "$0")/../lambda/leaderboard-updater" && pwd)"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIP_FILE="$REPO_ROOT/lambda-leaderboard-updater.zip"
ROLE_ARN="${LAMBDA_ROLE_ARN:-}"

if [[ -z "$ROLE_ARN" ]]; then
  echo "ERROR: LAMBDA_ROLE_ARN environment variable is required."
  echo "  Create an IAM role with AWSLambdaDynamoDBExecutionRole + DynamoDB read/write access."
  exit 1
fi

# Package Lambda
echo "Packaging Lambda..."
cd "$LAMBDA_DIR"
zip -r "$ZIP_FILE" dist/ node_modules/ 2>/dev/null
echo "Created $ZIP_FILE"

# Create or update function
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" &>/dev/null; then
  echo "Updating existing Lambda function..."
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://$ZIP_FILE" \
    --region "$REGION"
else
  echo "Creating Lambda function..."
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime nodejs20.x \
    --handler dist/index.handler \
    --role "$ROLE_ARN" \
    --zip-file "fileb://$ZIP_FILE" \
    --environment "Variables={DYNAMODB_TABLE_NAME=$TABLE}" \
    --timeout 60 \
    --memory-size 256 \
    --region "$REGION"
fi

# Wire up DynamoDB Streams trigger
echo ""
echo "Getting DynamoDB Stream ARN for $TABLE..."
STREAM_ARN=$(aws dynamodb describe-table \
  --table-name "$TABLE" \
  --region "$REGION" \
  --query "Table.LatestStreamArn" \
  --output text)

if [[ -z "$STREAM_ARN" || "$STREAM_ARN" == "None" ]]; then
  echo "ERROR: DynamoDB Streams not enabled on $TABLE."
  echo "  Enable with: aws dynamodb update-table --table-name $TABLE --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES --region $REGION"
  exit 1
fi

echo "Stream ARN: $STREAM_ARN"

# Check if mapping already exists
EXISTING=$(aws lambda list-event-source-mappings \
  --function-name "$FUNCTION_NAME" \
  --event-source-arn "$STREAM_ARN" \
  --region "$REGION" \
  --query "EventSourceMappings[0].UUID" \
  --output text 2>/dev/null || echo "None")

if [[ -z "$EXISTING" || "$EXISTING" == "None" ]]; then
  echo "Creating event source mapping..."
  aws lambda create-event-source-mapping \
    --function-name "$FUNCTION_NAME" \
    --event-source-arn "$STREAM_ARN" \
    --starting-position LATEST \
    --batch-size 10 \
    --bisect-batch-on-function-error \
    --region "$REGION"
else
  echo "Event source mapping already exists (UUID: $EXISTING) — skipping."
fi

echo ""
echo "Done. Lambda $FUNCTION_NAME is wired to DynamoDB Streams on $TABLE."
