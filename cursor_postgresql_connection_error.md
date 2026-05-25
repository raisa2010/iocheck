# PostgreSQL connection error
_Exported on 25/05/2026 at 7:55:26 GMT+6 from Cursor (3.5.33)_

---

**User**

fix this:

[Nest] 73544  - 23/05/2026, 3:41:18 am   ERROR [ExceptionHandler] Error: getaddrinfo ENOTFOUND postgres
    at GetAddrInfoReqWrap.onlookupall [as oncomplete] (node:dns:122:26) {
  errno: -3008,
  code: 'ENOTFOUND',
  syscall: 'getaddrinfo',
  hostname: 'postgres'

---

**Cursor**

The app is trying to connect to hostname `postgres`, which only resolves inside Docker/Kubernetes. I'll find where that's configured and fix local development.


The default host `postgres` only resolves inside Kubernetes. Changing the local default to `localhost` and setting `POSTGRES_HOST` in the K8s manifests.


---

**User**

this error occurs on next dev with a local postgres running via homebrew

---

**Cursor**

Checking your DB config and what Homebrew PostgreSQL expects locally.


---

**User**

in @api/test/app.e2e-spec.ts , write tests for the databaseService from database/*

---

**Cursor**

Reviewing `DatabaseService`, the existing e2e setup, and database entities to add focused tests.


Adding a dedicated `DatabaseService` e2e suite that uses the real Postgres connection and clears the table between tests.


---

**User**

the database service tests result in the following error:     A metric with the name ribbon_filter_blocks_total has already been registered.

---

**Cursor**

Prometheus metrics are registered twice because both e2e suites bootstrap `AppModule`. I'll inspect `MetricsService` and fix the test setup.


Bootstraping `AppModule` twice registers Prometheus metrics globally. Using a minimal TypeORM-only test module for `DatabaseService` tests avoids that.


---

**User**

replace the hardcoded credentials with github secrets env variables in app.module.ts for the TypeOrm config. add these to the k8s configs in k8s/

---

**Cursor**

Replacing hardcoded DB credentials with env vars and updating Kubernetes manifests. Checking the current setup.


Updating `app.module.ts` to require env vars and wiring K8s deployments to a `postgres-credentials` secret.


Removing the empty secret manifest — the deploy script creates the secret from env vars, and an empty manifest could overwrite real credentials.


Here’s what changed:

### `app.module.ts`
TypeORM now reads credentials only from environment variables (no hardcoded defaults):

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`

`POSTGRES_HOST` still defaults to `localhost` and `POSTGRES_PORT` to `5432` for local dev.

### `k8s/production.yaml` & `k8s/postgres-deployment.yaml`
Both deployments now pull credentials from a Kubernetes secret named `postgres-credentials`:

```yaml
valueFrom:
  secretKeyRef:
    name: postgres-credentials
    key: POSTGRES_DB  # also POSTGRES_USER, POSTGRES_PASSWORD
```

`POSTGRES_HOST` remains the literal `postgres` service name (not a secret).

### Deploy scripts
`scripts/deploy-minikube.sh` creates the secret from the same env var names before applying manifests:

```bash
export POSTGRES_DB=...
export POSTGRES_USER=...
export POSTGRES_PASSWORD=...
sh scripts/deploy-minikube.sh
```

In GitHub Actions, map repository secrets to those env vars, then use the `kubectl create secret generic ...` example in the comment at the top of `k8s/production.yaml`.

### Local dev
Export the vars before starting the API:

```bash
export POSTGRES_DB=myapp
export POSTGRES_USER=strongkeep
export POSTGRES_PASSWORD=postgres
npm run start:dev
```

Also add these three secrets in your GitHub repo settings: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`.

---

**User**

write the logs in a logs/logs.txt file if minikube is used 

---

**Cursor**

Updating `deploy-minikube.sh` to tee all output to `logs/logs.txt` and adding `logs/` to `.gitignore`.


`scripts/deploy-minikube.sh` now writes all deploy output to `logs/logs.txt`:

- Creates `logs/` if needed and truncates `logs/logs.txt` at the start of each run
- Uses `tee` so output still appears in the terminal and is saved to the file
- Adds start/finish timestamps in the log
- Adds `logs/` to `.gitignore` so log files are not committed

Run as usual:

```bash
sh scripts/deploy-minikube.sh
```

Then open `logs/logs.txt` for the full deploy log.

---

**User**

run some sql commands to create a user given the postgres_user env variable when the postgres container is deployed via minikube. run this before starting the service in the dockerfile or k8s yaml for postgres 

---

**Cursor**

Reviewing the Postgres deployment and init setup to determine where to create the user from `POSTGRES_USER`.


Fixing the broken init volume mount and adding an init script that creates the user from `POSTGRES_USER` / secret env vars via a ConfigMap.


Using `k8s/postgres/init-user.sh` as the single source of truth and creating the ConfigMap in the deploy script.


Here’s what was added:

### `k8s/postgres/init-user.sh`
Shell script mounted into `/docker-entrypoint-initdb.d/`. The official Postgres image runs it **only on first init** (empty PVC), before the server is ready for clients. It uses `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` from the secret to:

1. `CREATE ROLE` (or `ALTER ROLE` if it already exists)
2. `CREATE DATABASE` if missing
3. Grant DB/schema privileges

### `k8s/postgres-deployment.yaml`
- Fixed the broken volume mount (was an invalid path)
- Mounts ConfigMap `postgres-init` at `/docker-entrypoint-initdb.d` with mode `0755`

### `scripts/deploy-minikube.sh`
- Creates `postgres-init` ConfigMap from `k8s/postgres/init-user.sh`
- Applies Postgres **before** the API deployment
- Waits for Postgres rollout before `nest-api`

### Removed
- `api/postgres/init.sql` (hardcoded `strongkeep` / `myapp`)

**Note:** Init scripts run only when the data directory is empty. If Postgres was deployed before with the old setup, delete the PVC and redeploy:

```bash
kubectl delete pvc postgres-data
export POSTGRES_DB=... POSTGRES_USER=... POSTGRES_PASSWORD=...
sh scripts/deploy-minikube.sh
```

---

**User**

run db creation script before the databaseservice tests

---

**Cursor**

Adding a test DB setup helper (mirroring the k8s init script) and calling it in `beforeAll` before the DatabaseService tests.


Fixing parameter binding in the setup script — PostgreSQL `DO` blocks don't accept outer query parameters from `pg`.


---

**User**

set up the db when npm run start:dev is also run in a similar way as the tests - using env variables for the db credentials

---

**Cursor**

Extracting shared DB setup logic and invoking it on `start:dev`, matching the e2e test flow.


---

**User**

run npm run db:setup in the dockerfile before running start

---

**Cursor**

Updating the Dockerfile and package scripts so `db:setup` runs against the compiled JS in production, and fixing admin DB credentials for remote Postgres (K8s).


---

**User**

the db connection times out during authentication

---

**Cursor**

Tracing the DB connection flow to find why authentication is timing out.


Fixing admin credential selection for K8s/Docker (was using the container's `USER` instead of `POSTGRES_USER`) and adding connection timeouts with retries while Postgres starts.


Fixing admin connections: use `template1` (the `postgres` DB may not exist when `POSTGRES_USER` is set) and use `POSTGRES_USER`/`POSTGRES_PASSWORD` for remote hosts instead of the container's `USER`.


The authentication timeout came from a few combined issues:

### Root causes
1. **Wrong admin credentials in Docker/K8s** — `db:setup` used the container’s `USER` with an empty password instead of `POSTGRES_USER` / `POSTGRES_PASSWORD` from the secret.
2. **Wrong database for admin connect** — With `POSTGRES_USER` set, the official Postgres image often **does not** create a `postgres` database. Connecting to `postgres` fails or hangs after auth.
3. **Startup race** — The API container ran `db:setup` before Postgres was ready.

### Fixes in `setup-database.ts`
- **Remote hosts** (`POSTGRES_HOST` ≠ localhost): admin uses `POSTGRES_USER` / `POSTGRES_PASSWORD`.
- **Local dev**: admin still uses `POSTGRES_ADMIN_USER` or your OS user (`$USER`).
- Admin connects to **`template1`** (always exists), not `postgres`.
- **5s connection timeout** and **retries** (30 × 2s) while Postgres comes up.

### K8s (`deployment.yaml`, `k8s/production.yaml`)
- **`wait-for-postgres` initContainer** runs `pg_isready` with the secret credentials before the API starts.

### `app.module.ts`
- TypeORM `connectionTimeoutMillis: 10000` so the app fails fast instead of hanging.

Rebuild and redeploy:

```bash
export POSTGRES_DB=... POSTGRES_USER=... POSTGRES_PASSWORD=...
sh scripts/deploy-minikube.sh
```

If Postgres was initialized earlier with different credentials, reset the volume:

```bash
kubectl delete pvc postgres-data
kubectl delete deployment postgres
sh scripts/deploy-minikube.sh
```

---

**User**

use ./postgres/init.sql:/docker-entrypoint-initdb.d/init.sql to generate the sql file for initialising a new db

---

**Cursor**

Adding an init SQL template, a generator script, and fixing the Kubernetes volume mount to use the generated `init.sql`.


---

**User**

modify this to actually write to the output - at the moment it is empty:
@generate-postgres-init.sh (20-24) 

---

**Cursor**

TEMPLATE and OUTPUT both point to `init.sql`, so `sed` truncates the file before reading it. Fixing paths and restoring `init.sql.template`.


---

**User**

debug the prometheus-adapter deployment

---

**Cursor**

Investigating the prometheus-adapter deployment configuration and cluster state.


---

**User**

debug the env var setting in the nest-api for minikube @deployment.yaml Database setup failed: no PostgreSQL user name specified in startup packet

---

**Cursor**

Identifying the issue: `setup-database.ts` creates the admin `pg` client without `user` or `password`, causing the empty-username error. Fixing that and tightening env handling for Minikube.


The error came from two places—not from the Kubernetes env wiring itself.

### Root cause
In `setup-database.ts`, the admin `pg` client was created **without `user` or `password`**:

```typescript
new Client({ host, port, database: 'postgres' })  // no user → empty startup packet
```

`deployment.yaml` was already injecting `POSTGRES_USER` correctly; `db:setup` simply never used it for the first connection.

### Fixes

**`setup-database.ts`**
- Passes `adminUser` / `adminPassword` on every connection (remote: same as `POSTGRES_USER` / `POSTGRES_PASSWORD` from the secret).
- Connects to `template1` instead of `postgres` (the `postgres` DB often doesn’t exist when `POSTGRES_USER` is set).
- Requires non-empty `POSTGRES_*` values when `POSTGRES_HOST` is not localhost (`.trim()` so empty secret values fail clearly).

**`deployment.yaml`**
- Uses `envFrom: secretRef: postgres-credentials` so all three secret keys are loaded together.
- Keeps explicit `POSTGRES_HOST=postgres` plus app env vars.

Rebuild and redeploy:

```bash
export POSTGRES_DB=myapp POSTGRES_USER=strongkeep POSTGRES_PASSWORD=yourpassword
sh scripts/deploy-minikube.sh
```

Verify the secret has data:

```bash
kubectl get secret postgres-credentials -o jsonpath='{.data.POSTGRES_USER}' | base64 -d; echo
```

If that prints nothing, recreate the secret with the `export` vars set before running the deploy script.

---

**User**

the prometheus adapter is timing out

