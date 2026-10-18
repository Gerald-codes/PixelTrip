#!/usr/bin/env bash
# One-time AWS setup for the backend. Safe to run again: it reuses what already exists.
#
# Creates, in $AWS_REGION (default Singapore):
#   - an ECR repository for the backend image
#   - an IAM role for the server (pull the image, read its settings, accept deploy commands)
#   - a security group open on 80 and 443 only (no SSH; deploys go through Systems Manager)
#   - a fixed public IP
#   - one EC2 instance (Amazon Linux 2023, ARM) that installs Docker on first boot
#
# Needs: the AWS CLI logged in as a user allowed to create these.
# Next: ./deploy/push-env.sh, then ./deploy/deploy.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./config.sh

ROLE="${APP_NAME}-ec2"
SG_NAME="${APP_NAME}-web"

echo "==> Account $(account_id), region ${AWS_REGION}"

echo "==> ECR repository"
aws ecr describe-repositories --repository-names "$APP_NAME" >/dev/null 2>&1 ||
  aws ecr create-repository --repository-name "$APP_NAME" \
    --image-scanning-configuration scanOnPush=true >/dev/null
# Keep the last 10 images so the repository does not grow (and cost) without limit.
aws ecr put-lifecycle-policy --repository-name "$APP_NAME" --lifecycle-policy-text '{
  "rules": [{"rulePriority": 1, "description": "keep the last 10 images",
    "selection": {"tagStatus": "any", "countType": "imageCountMoreThan", "countNumber": 10},
    "action": {"type": "expire"}}]}' >/dev/null

echo "==> IAM role for the server"
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{"Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"},
      "Action": "sts:AssumeRole"}]}' >/dev/null
fi
aws iam attach-role-policy --role-name "$ROLE" \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam attach-role-policy --role-name "$ROLE" \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
# Read only this app's settings, nothing else in Parameter Store.
aws iam put-role-policy --role-name "$ROLE" --policy-name read-app-settings --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{\"Effect\": \"Allow\", \"Action\": \"ssm:GetParametersByPath\",
    \"Resource\": [\"arn:aws:ssm:${AWS_REGION}:$(account_id):parameter${PARAM_PATH}\",
      \"arn:aws:ssm:${AWS_REGION}:$(account_id):parameter${PARAM_PATH}/*\"]}]}"
if ! aws iam get-instance-profile --instance-profile-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$ROLE" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE"
  echo "    waiting for the new role to become usable..."
  sleep 15
fi

echo "==> Security group (80 and 443 only)"
VPC_ID="$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)"
if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
  echo "No default VPC in ${AWS_REGION}. Create one: aws ec2 create-default-vpc" >&2
  exit 1
fi
SG_ID="$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
  --query 'SecurityGroups[0].GroupId' --output text)"
if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  SG_ID="$(aws ec2 create-security-group --group-name "$SG_NAME" --vpc-id "$VPC_ID" \
    --description "PixelTrip backend: HTTP and HTTPS" --query GroupId --output text)"
  for port in 80 443; do
    aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
      --protocol tcp --port "$port" --cidr 0.0.0.0/0 >/dev/null
  done
  # HTTP/3
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --protocol udp --port 443 --cidr 0.0.0.0/0 >/dev/null
fi

echo "==> Fixed public IP"
if [ -z "$(elastic_ip)" ]; then
  aws ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${APP_NAME}}]" >/dev/null
fi
HOST="$(backend_host)"
echo "    https://${HOST}"

echo "==> Server"
INSTANCE_ID="$(instance_id)"
if [ -z "$INSTANCE_ID" ]; then
  AMI="$(aws ssm get-parameter \
    --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
    --query Parameter.Value --output text)"
  USER_DATA="$(mktemp)"
  trap 'rm -f "$USER_DATA"' EXIT
  sed -e "s|__REGION__|${AWS_REGION}|g" \
      -e "s|__REGISTRY__|$(ecr_registry)|g" \
      -e "s|__APP_NAME__|${APP_NAME}|g" \
      -e "s|__PARAM_PATH__|${PARAM_PATH}|g" \
      -e "s|__HOST__|${HOST}|g" \
      ./server-init.sh > "$USER_DATA"
  INSTANCE_ID="$(aws ec2 run-instances \
    --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
    --iam-instance-profile "Name=${ROLE}" \
    --security-group-ids "$SG_ID" \
    --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=16,VolumeType=gp3,Encrypted=true}' \
    --metadata-options 'HttpTokens=required,HttpEndpoint=enabled' \
    --user-data "file://${USER_DATA}" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${APP_NAME}}]" \
    --query 'Instances[0].InstanceId' --output text)"
  echo "    started ${INSTANCE_ID}, waiting for it to run..."
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
else
  echo "    reusing ${INSTANCE_ID}"
fi

ALLOCATION_ID="$(aws ec2 describe-addresses --filters "Name=tag:Name,Values=${APP_NAME}" \
  --query 'Addresses[0].AllocationId' --output text)"
aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOCATION_ID" >/dev/null

cat <<DONE

Done.
  Server:       ${INSTANCE_ID} (${INSTANCE_TYPE})
  Backend URL:  https://${HOST}   (answers after the first deploy)

Next:
  1. ./deploy/push-env.sh     upload the settings from backend/.env
  2. ./deploy/deploy.sh       build the image and start it on the server
  3. In Vercel, set NEXT_PUBLIC_API_BASE_URL=https://${HOST} and redeploy.
DONE
