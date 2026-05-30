#!/bin/bash
# Enable DynamoDB Global Tables for bughunt-main
# Run this ONCE after the table is created and populated
# Requires AWS CLI configured with appropriate permissions

REGION="${AWS_REGION:-us-east-1}"
TABLE="bughunt-main"
REPLICA_REGION="eu-west-1"

echo "Enabling Global Tables replication for $TABLE..."
echo "Source region: $REGION"
echo "Replica region: $REPLICA_REGION"

aws dynamodb update-table \
  --table-name "$TABLE" \
  --replica-updates "[{\"Create\":{\"RegionName\":\"$REPLICA_REGION\"}}]" \
  --region "$REGION"

echo ""
echo "Replication initiated. It may take 30-60 minutes to fully propagate."
echo "Check status with:"
echo "  aws dynamodb describe-table --table-name $TABLE --region $REGION | jq '.Table.Replicas'"
