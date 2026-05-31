#!/bin/bash
# Enable DynamoDB Global Tables for bughunt-main (3 regions)
# Run this ONCE after the table is created and populated
# Requires AWS CLI configured with appropriate permissions

REGION="${AWS_REGION:-us-east-1}"
TABLE="bughunt-main"
REPLICA_REGION_EU="eu-west-1"
REPLICA_REGION_APAC="ap-southeast-1"

echo "Enabling Global Tables replication for $TABLE..."
echo "Source region: $REGION"
echo "Replica region 1: $REPLICA_REGION_EU"
echo "Replica region 2: $REPLICA_REGION_APAC"

echo ""
echo "Adding EU replica ($REPLICA_REGION_EU)..."
aws dynamodb update-table \
  --table-name "$TABLE" \
  --replica-updates "[{\"Create\":{\"RegionName\":\"$REPLICA_REGION_EU\"}}]" \
  --region "$REGION"

echo ""
echo "Waiting 30 seconds before adding APAC replica..."
sleep 30

echo ""
echo "Adding APAC replica ($REPLICA_REGION_APAC)..."
aws dynamodb update-table \
  --table-name "$TABLE" \
  --replica-updates "[{\"Create\":{\"RegionName\":\"$REPLICA_REGION_APAC\"}}]" \
  --region "$REGION"

echo ""
echo "Replication initiated for both replicas. It may take 30-60 minutes to fully propagate."
echo "Check status with:"
echo "  aws dynamodb describe-table --table-name $TABLE --region $REGION | jq '.Table.Replicas'"
