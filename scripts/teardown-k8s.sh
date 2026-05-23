#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

STOP_MINIKUBE=false
STOP_COLIMA=false
KILL_PORT_FORWARDS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stop-minikube) STOP_MINIKUBE=true; shift;;
    --stop-colima) STOP_COLIMA=true; shift;;
    --kill-port-forwards) KILL_PORT_FORWARDS=true; shift;;
    --help|-h)
      cat <<EOF
Usage: $(basename "$0") [--stop-minikube] [--stop-colima] [--kill-port-forwards]

Options:
  --stop-minikube       Stop the minikube VM after deleting k8s resources
  --stop-colima         Stop the Colima VM after deleting k8s resources
  --kill-port-forwards  Kill any running kubectl port-forward processes
  -h, --help            Show this help
EOF
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done

MANIFESTS=(
  deployment.yaml
  k8s/service.yaml
  k8s/memcached-deployment.yaml
  k8s/postgres-deployment.yaml
  k8s/monitoring.yaml
  k8s/service-prod.yaml
  k8s/hpa.yaml
  k8s/production.yaml
)

echo "Deleting Kubernetes resources (ignore-not-found)..."
kubectl delete secret postgres-credentials --ignore-not-found
kubectl delete configmap postgres-init --ignore-not-found
for m in "${MANIFESTS[@]}"; do
  if [ -f "$m" ]; then
    echo "  kubectl delete -f $m"
    kubectl delete -f "$m" --ignore-not-found
  fi
done

# Also delete common resource names in case they were applied differently
echo "Deleting named resources (deployments, services, ingress, hpa)..."
kubectl delete deployment/nest-api --ignore-not-found
kubectl delete deployment/memcached --ignore-not-found
kubectl delete service/nest-api --ignore-not-found
kubectl delete service/memcached --ignore-not-found
kubectl delete ingress/nest-api-ingress --ignore-not-found
kubectl delete hpa/nest-api-hpa --ignore-not-found

if [ "$KILL_PORT_FORWARDS" = true ]; then
  echo "Killing kubectl port-forward processes..."
  pkill -f "kubectl port-forward" || true
fi

echo "Resources deleted."

if [ "$STOP_MINIKUBE" = true ]; then
  if command -v minikube >/dev/null 2>&1; then
    echo "Stopping minikube..."
    minikube stop || true
  else
    echo "minikube not installed or not in PATH. Skipping stop."
  fi
fi

if [ "$STOP_COLIMA" = true ]; then
  if command -v colima >/dev/null 2>&1; then
    echo "Stopping Colima..."
    colima stop || true
  else
    echo "colima not installed or not in PATH. Skipping stop."
  fi
fi

echo "Teardown complete."
