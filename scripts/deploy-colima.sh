#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

IMAGE_TAG="strongkeep-api:latest"

echo "1/5: Starting Colima with Kubernetes (this may take a minute)..."
colima status >/dev/null 2>&1 || true
colima start --kubernetes

echo "2/5: Building Docker image: $IMAGE_TAG"
docker build -t "$IMAGE_TAG" -f Dockerfile .

echo "3/5: Applying Kubernetes manifests"
kubectl apply -f deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/memcached-deployment.yaml

echo "4/5: Waiting for deployment rollouts"
kubectl rollout status deployment/nest-api --timeout=120s || true
kubectl rollout status deployment/memcached --timeout=60s || true

echo "5/5: Finalizing"
echo "Service is exposed on NodePort 30000 (host port). If NodePort isn't reachable, port-forwarding can be used instead."
echo "Access the API at: http://localhost:30000  (or run: kubectl port-forward svc/nest-api 3000:3000)"

