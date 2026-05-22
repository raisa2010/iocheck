# Strongkeep

## Architecture Overview

This repository implements a NestJS-based IOC (Indicator of Compromise) analysis service with caching, request filtering, metrics, and Kubernetes deployment support.

The overall architecture is:

```text
                   +--------------------+
                   |    Client / API    |
                   +--------------------+
                             |
                             v
                    +------------------+
                    | Kubernetes       |
                    | Service / Ingress|
                    +------------------+
                             |
                             v
                 +---------------------------+
                 | NestJS API (`api/`)       |
                 |  - AppController          |
                 |                           |
                 |  - MetricsService         |
                 |  |
                 +---------------------------+
                             |
                             v
                  +-----------------------------+
                  | Local IOC store in          |
                  | `ThreatIndicatorService`    |
                  +-----------------------------+
                            |
                            v
                  +-----------------------------+
                  | Memcached cache             | 
                  |   (`k8s/memcached-*`)       |
                  |                             |
                  +-----------------------------+
                            |
                            v
                  +-----------------------------+
                  | PostgreSQL / persistent db  |
                  |   (planned / future layer)  |
                  +-----------------------------+
```

## Key Components

- `api/src/app.controller.ts`
  - Exposes health, readiness, metrics, lookup, and IOC upsert endpoints.
- `api/src/security/ribbon-filter.middleware.ts`
  - Blocks known malicious requests early and records ribbon filter metrics.
- `api/src/security/memcached.service.ts`
  - Wraps `memjs` with `get`, `set`, `delete`, and `ping` operations.
- `api/src/security/threat-indicator.service.ts`
  - Handles IOC lookup and upsert logic with local in-memory storage and memcached cache.
- `api/src/metrics/metrics.service.ts`
  - Exposes Prometheus metrics and request latency histogram.
- `api/src/metrics/latency.middleware.ts`
  - Records bucketed per-route latency for `POST /lookup`.

## Deployment

- `Dockerfile`: Builds the NestJS API container.
- `deployment.yaml`: Production-ready Kubernetes manifest with probes and resource requests.
- `k8s/service.yaml`: NodePort service example.
- `k8s/memcached-deployment.yaml`: Memcached deployment and service.
- `k8s/monitoring.yaml`: Prometheus + Node Exporter monitoring stack.
- `k8s/production.yaml`: Combined production manifest sample.
- `scripts/`: Helper scripts for Minikube/Colima deployment and teardown.

## Running Locally

1. Enter the API folder:
   ```bash
   cd api
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the API:
   ```bash
   npm run start:dev
   ```

## Running with Kubernetes

1. Start a local Kubernetes cluster:
   ```bash
   # Minikube
   minikube start --cpus=4 --memory=4096

   # or Colima
   colima start --cpu=4 --memory=4
   ```

2. Build the API container image for the cluster and deploy using the helper script:
   ```bash
   sh scripts/deploy-minikube.sh
   minikube service nest-api
   ```

3. Use the port in the running service to call the APIs, for example:
   ```bash
   curl http://localhost:<port>/readyz
   ```

## Monitoring

This repository includes a monitoring manifest at `k8s/monitoring.yaml`.

Deploy it with:

```bash
kubectl apply -f k8s/monitoring.yaml
```

It installs Prometheus and Node Exporter in the `monitoring` namespace so you can collect:

- CPU metrics
- memory metrics
- disk I/O metrics

### Prometheus access

Forward the Prometheus UI locally:

```bash
kubectl port-forward -n monitoring svc/prometheus 9090:9090
```

Open:

```bash
http://localhost:9090
```

Example Prometheus queries:

- `node_cpu_seconds_total`
- `node_memory_MemAvailable_bytes`
- `node_disk_io_time_seconds_total`
- `node_disk_reads_completed_total`
- `node_disk_writes_completed_total`

### Kubernetes CPU / memory metrics

For `kubectl top` and HPA support, make sure the cluster has `metrics-server` enabled.

Check usage with:

```bash
kubectl top pods
kubectl top nodes
```

If you use Minikube, the repo's `scripts/deploy-minikube.sh` already enables `metrics-server`.

## Connecting to Memcached via Telnet

1. Forward the memcached service port to localhost:
   ```bash
   kubectl port-forward service/memcached 11211:11211
   ```

2. In another terminal, connect with telnet:
   ```bash
   telnet localhost 11211
   ```

3. Run a simple memcached text protocol interaction:
   ```text
   set test-key 0 3600 5
   hello
   STORED
   get test-key
   VALUE test-key 0 5
   hello
   END
   delete test-key
   DELETED
   quit
   ```

> If `telnet` is not installed on macOS, install it with `brew install telnet` or use `nc localhost 11211` as an alternative.

## Teardown Kubernetes

1. Tear down the deployed resources:
   ```bash
   sh scripts/teardown-k8s.sh
   ```

## API Endpoints

- `GET /healthz` — basic health check
- `GET /readyz` — readiness check; validates memcached connectivity
- `GET /metrics` — Prometheus metrics output
- `POST /lookup` — IOC lookup
- `POST /ioc` — admin upsert of IOC data

## Notes

- `api/README.md` contains API-specific documentation and test instructions.
- This repo is structured for a stateless API layer with external caching and a persistent datastore.
