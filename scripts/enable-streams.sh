#!/bin/bash
# Enable DynamoDB Streams (NEW_AND_OLD_IMAGES) on the existing table — required
# by the leaderboard-updater Lambda. Idempotent.
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
TABLE="${DYNAMODB_TABLE_NAME:-bughunt-main}"

CURRENT=$(aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" \
  --query "Table.StreamSpecification.StreamEnabled" --output text 2>/dev/null || echo "None")

if [[ "$CURRENT" == "True" ]]; then
  echo "Streams already enabled on $TABLE."
else
  aws dynamodb update-table \
    --table-name "$TABLE" \
    --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES \
    --region "$REGION" >/dev/null
  echo "Streams enabled on $TABLE."
fi

echo -n "Stream ARN: "
aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" \
  --query "Table.LatestStreamArn" --output text
