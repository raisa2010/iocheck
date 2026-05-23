#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

IMAGE_TAG="strongkeep-api:latest"

echo "1/6: Starting minikube..."
minikube status >/dev/null 2>&1 || minikube start

echo "2/6: Enabling minikube addons (ingress, metrics-server)..."
minikube addons enable ingress || true
minikube addons enable metrics-server || true

echo "3/6: Setting up Docker environment for minikube..."
eval $(minikube docker-env)

echo "4/6: Building Docker image in minikube: $IMAGE_TAG"
docker build -t "$IMAGE_TAG" -f Dockerfile .

echo "5/6: Applying Kubernetes manifests"
kubectl create secret generic postgres-credentials \
  --from-literal=POSTGRES_DB="${POSTGRES_DB:?POSTGRES_DB is required}" \
  --from-literal=POSTGRES_USER="${POSTGRES_USER:?POSTGRES_USER is required}" \
  --from-literal=POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}" \
  --dry-run=client -o yaml | kubectl apply -f -
sh scripts/generate-postgres-init.sh
kubectl create configmap postgres-init \
  --from-file=init.sql=api/postgres/init.sql \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f k8s/postgres-deployment.yaml
kubectl apply -f deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/memcached-deployment.yaml
kubectl apply -f k8s/monitoring.yaml
kubectl apply -f k8s/hpa.yaml

echo "6/6: Waiting for deployment rollouts"
kubectl rollout status deployment/postgres --timeout=120s || true
kubectl rollout status deployment/nest-api --timeout=120s || true
kubectl rollout status deployment/memcached --timeout=60s || true
kubectl rollout status deployment/prometheus -n monitoring --timeout=120s || true
kubectl rollout status deployment/prometheus-adapter -n monitoring --timeout=120s || true

echo ""
echo "========================================="
echo "Minikube deployment complete!"
echo "========================================="
echo ""
echo "Service NodePort: 30000"
echo ""
echo "Access options:"
echo "  1. Via minikube service (auto port-forward):"
echo "     minikube service nest-api"
echo ""
echo "  2. Via kubectl port-forward:"
echo "     kubectl port-forward svc/nest-api 3000:3000"
echo ""
echo "  3. Via minikube tunnel (requires admin/sudo):"
echo "     minikube tunnel"
echo "     curl http://localhost:30000"
echo ""
echo "View metrics:"
echo "  curl http://localhost:3000/metrics"
echo ""
echo "Check pods:"
echo "  kubectl get pods,svc"
echo ""
echo "===== Minikube deploy finished at $(date -u +"%Y-%m-%dT%H:%M:%SZ") ====="
