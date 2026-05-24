#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

SERVICE_URL="${1:-http://localhost:54815}"
CONCURRENCY="${2:-200}"
REQUESTS="${3:-100000}"
HPA_NAME="nest-api-hpa"
POD_LABEL="app=nest-api"

PAYLOAD_FILE="$(mktemp)"
cat > "$PAYLOAD_FILE" <<'EOF'
{"type":"ip","value":"203.0.113.1"}
EOF
trap 'rm -f "$PAYLOAD_FILE"' EXIT

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

url = '$SERVICE_URL/lookup'
body = json.dumps({"type": "ip", "value": "203.0.113.1"}).encode('utf-8')
headers = {'Content-Type': 'application/json'}

success = 0
errors = 0
start = time.time()


def request_one(index):
    req = urllib.request.Request(url, data=body, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.getcode()
            return status
    except urllib.error.HTTPError as exc:
        return f'ERROR {exc.code}'
    except Exception as exc:
        return f'ERROR {exc}'

with concurrent.futures.ThreadPoolExecutor(max_workers=int($CONCURRENCY)) as executor:
    futures = [executor.submit(request_one, i) for i in range(int($REQUESTS))]
    for future in concurrent.futures.as_completed(futures):
        result = future.result()
        if isinstance(result, int) and 200 <= result < 300:
            success += 1
        else:
            errors += 1
            print(result)

end = time.time()
print(f'Requests: {int($REQUESTS)} Concurrency: {int($CONCURRENCY)}')
print(f'Success: {success} Errors: {errors}')
print(f'Time elapsed: {end - start:.2f}s')
PY
}

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required to run this test." >&2
  exit 1
fi

if command -v ab >/dev/null 2>&1; then
  echo "Using ApacheBench for load generation."
  echo "Target URL: $SERVICE_URL/lookup"
  echo "Requests: $REQUESTS  Concurrency: $CONCURRENCY"
  ab -n "$REQUESTS" -c "$CONCURRENCY" -p "$PAYLOAD_FILE" -T 'application/json' "$SERVICE_URL/lookup"
else
  echo "ApacheBench not found; using Python built-in load generator."
  run_python_load
fi

echo
show_status

echo "Waiting 45 seconds for HPA to observe metrics and adjust replicas..."
sleep 45

echo
show_status

echo "Load test complete. Check Grafana at http://localhost:3000 with the Prometheus datasource for request rate metrics."
