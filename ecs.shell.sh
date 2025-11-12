#!/bin/bash

set -e
# set -x
set -o pipefail

AWS_REGION=$(aws configure get region || echo "us-east-2")

CONTAINER=$1
if [ "-h" == "$CONTAINER" ] || [ "--help" == "$CONTAINER" ]; then
  echo "Usage: $0 [CONTAINER] [ENVIRONMENT]"
  echo ""
  echo "  CONTAINER: api, web, worker"
  echo "  ENVIRONMENT: Dev, Staging, Prod"
  exit
fi
CONTAINER=${CONTAINER:-app}

ENVIRONMENT=$2
ENVIRONMENT=${ENVIRONMENT:-Dev}

NAME=$(jq .name package.json -r | sed -E 's|.*/||; s/"//g')

echo "Connecting to first $CONTAINER container in $ENVIRONMENT environment in project $NAME in region $AWS_REGION"

TASKS=$(aws ecs list-tasks --cluster "${NAME}-${ENVIRONMENT}-cluster" --output text --query 'taskArns' --output text)

TASK_ARN=$(aws ecs describe-tasks --tasks $TASKS --cluster "${NAME}-${ENVIRONMENT}-cluster" --query "tasks[].containers[?name=='$CONTAINER'].taskArn" --output text | head -1)

echo "Found task ARN: $TASK_ARN"

aws ecs execute-command \
  --region "$AWS_REGION" \
  --cluster "${NAME}-${ENVIRONMENT}-cluster" \
  --task "$TASK_ARN" \
  --container "$CONTAINER" \
 --command "/bin/bash" \
  --interactive


