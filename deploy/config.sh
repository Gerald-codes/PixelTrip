# Shared settings for the deploy scripts. Sourced, not run.
#
# Override any of these in your shell before running a script, e.g.
#   AWS_PROFILE=pixeltrip ./deploy/aws-setup.sh

export AWS_REGION="${AWS_REGION:-ap-southeast-1}"   # Singapore
export AWS_DEFAULT_REGION="$AWS_REGION"

APP_NAME="${APP_NAME:-pixeltrip-backend}"            # ECR repo, instance Name tag, role
PARAM_PATH="${PARAM_PATH:-/pixeltrip/prod}"          # Parameter Store folder for the env vars
INSTANCE_TYPE="${INSTANCE_TYPE:-t4g.small}"          # 2 vCPU, 2 GB, ARM
FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-https://pixel-trip-booth.vercel.app,https://aws-pixeltrip.vercel.app}"

account_id() { aws sts get-caller-identity --query Account --output text; }
ecr_registry() { echo "$(account_id).dkr.ecr.${AWS_REGION}.amazonaws.com"; }

# The running backend instance's id (empty if there is none).
instance_id() {
  aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=${APP_NAME}" "Name=instance-state-name,Values=pending,running,stopped" \
    --query 'Reservations[].Instances[].InstanceId' --output text
}

# The backend's fixed public IP (empty before aws-setup.sh has run).
elastic_ip() {
  aws ec2 describe-addresses --filters "Name=tag:Name,Values=${APP_NAME}" \
    --query 'Addresses[0].PublicIp' --output text 2>/dev/null | grep -v '^None$' || true
}

# The backend's HTTPS hostname. sslip.io maps "1-2-3-4.sslip.io" to 1.2.3.4, which lets
# Caddy get a real certificate without owning a domain.
backend_host() {
  local ip; ip="$(elastic_ip)"
  if [ -n "$ip" ]; then echo "${ip//./-}.sslip.io"; fi
}
