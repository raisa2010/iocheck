#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

SERVICE_URL="${1:-http://localhost:54815}"
CONCURRENCY="${2:-200}"
REQUESTS="${3:-100000}"
IP_POOL_SIZE="${4:-1000}"

HPA_NAME="nest-api-hpa"
POD_LABEL="app=nest-api"

function show_status() {
  echo "--- HPA status ---"
  kubectl get hpa "$HPA_NAME"
  echo
  echo "--- Pods ---"
  kubectl get pods -l "$POD_LABEL"
  echo
}

function run_python_load() {
  python3 - <<PY
import concurrent.futures
import json
import urllib.request
import urllib.error
import time
import random

url = '$SERVICE_URL/lookup'
headers = {'Content-Type': 'application/json'}

success = 0
errors = 0
start = time.time()

IP_POOL_SIZE = int($IP_POOL_SIZE)

# Generate rotating IP pool
ip_pool = [
    f"203.0.{i // 256}.{i % 256}"
    for i in range(IP_POOL_SIZE)
]

def request_one(index):
    ip = ip_pool[index % IP_POOL_SIZE]

    body = json.dumps({
        "type": "ip",
        "value": ip
    }).encode('utf-8')

    req = urllib.request.Request(
        url,
        data=body,
        headers=headers,
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.getcode()
    except urllib.error.HTTPError as exc:
        return f'ERROR {exc.code}'
    except Exception as exc:
        return f'ERROR {exc}'

with concurrent.futures.ThreadPoolExecutor(
    max_workers=int($CONCURRENCY)
) as executor:

    futures = [
        executor.submit(request_one, i)
        for i in range(int($REQUESTS))
    ]

    for future in concurrent.futures.as_completed(futures):
        result = future.result()

        if isinstance(result, int) and 200 <= result < 300:
            success += 1
        else:
            errors += 1
            print(result)

end = time.time()

print(f'Requests: {int($REQUESTS)}')
print(f'Concurrency: {int($CONCURRENCY)}')
print(f'Rotating IP pool size: {IP_POOL_SIZE}')
print(f'Success: {success}')
print(f'Errors: {errors}')
print(f'Time elapsed: {end - start:.2f}s')
PY
}

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required to run this test." >&2
  exit 1
fi

echo "Target URL: $SERVICE_URL/lookup"
echo "Requests: $REQUESTS"
echo "Concurrency: $CONCURRENCY"
echo "Rotating IP pool size: $IP_POOL_SIZE"

run_python_load

echo
show_status

echo "Waiting 45 seconds for HPA to observe metrics and adjust replicas..."
sleep 45

echo
show_status

echo "Load test complete."
echo "Check Grafana at http://localhost:3000 with the Prometheus datasource for request rate metrics."