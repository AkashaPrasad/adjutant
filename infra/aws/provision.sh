#!/usr/bin/env bash
# Provision the Adjutant Gate backend host on AWS Lightsail (idempotent, safe to re-run).
#   Instance:   adjutant-gate, Ubuntu 24.04, micro_3_1 (2 vCPU, 1 GB), ap-south-1 (Mumbai)
#   Static IP:  adjutant-gate-ip, target of the api.adjutant.spacesdrive.cc A record
#   Firewall:   80 and 443 only. No SSH: deploys arrive through the signed HTTPS hook.
# Bootstrapped by infra/aws/host-bootstrap.sh, which holds no secrets.
# Reads AWS_* from the repo-root .env and prints the static IP.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
set -a; . "$ROOT/.env"; set +a
unset AWS_PROFILE
export AWS_DEFAULT_REGION="${AWS_REGION:-ap-south-1}"
NAME=adjutant-gate

if ! aws lightsail get-instance --instance-name "$NAME" >/dev/null 2>&1; then
  aws lightsail create-instances --instance-names "$NAME" \
    --availability-zone "${AWS_DEFAULT_REGION}a" \
    --blueprint-id ubuntu_24_04 --bundle-id micro_3_1 \
    --user-data "file://$ROOT/infra/aws/host-bootstrap.sh" \
    --tags key=Project,value=adjutant >/dev/null
fi

for _ in $(seq 1 60); do
  state=$(aws lightsail get-instance --instance-name "$NAME" --query 'instance.state.name' --output text)
  [ "$state" = running ] && break
  sleep 5
done

if ! aws lightsail get-static-ip --static-ip-name "$NAME-ip" >/dev/null 2>&1; then
  aws lightsail allocate-static-ip --static-ip-name "$NAME-ip" >/dev/null
fi
attached=$(aws lightsail get-static-ip --static-ip-name "$NAME-ip" --query 'staticIp.attachedTo' --output text)
if [ "$attached" != "$NAME" ]; then
  aws lightsail attach-static-ip --static-ip-name "$NAME-ip" --instance-name "$NAME" >/dev/null
fi

aws lightsail put-instance-public-ports --instance-name "$NAME" --port-infos \
  fromPort=80,toPort=80,protocol=tcp fromPort=443,toPort=443,protocol=tcp >/dev/null

IP=$(aws lightsail get-static-ip --static-ip-name "$NAME-ip" --query 'staticIp.ipAddress' --output text)
echo "BACKEND_INSTANCE=$NAME"
echo "BACKEND_IP=$IP"
