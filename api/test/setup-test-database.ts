import { Client } from 'pg';

export interface TestDatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  adminUser: string;
  adminPassword: string;
}

export function getTestDatabaseConfig(): TestDatabaseConfig {
  return {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'myapp-test',
    user: process.env.POSTGRES_USER ?? 'strongkeep',
    password: process.env.POSTGRES_PASSWORD ?? 'postgres',
    adminUser: process.env.POSTGRES_ADMIN_USER ?? process.env.USER ?? 'postgres',
    adminPassword: process.env.POSTGRES_ADMIN_PASSWORD ?? '',
  };
}

/** Mirrors k8s/postgres/init-user.sh — creates role and database before e2e tests run. */
export async function setupTestDatabase(
  config: TestDatabaseConfig = getTestDatabaseConfig(),
): Promise<void> {
  const admin = new Client({
    host: config.host,
    port: config.port,
    user: config.adminUser,
    password: config.adminPassword,
    database: 'postgres',
  });

  await admin.connect();

  const { rows: roleRows } = await admin.query<{ stmt: string }>(
    `
    SELECT format(
      CASE
        WHEN EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = $1::text)
          THEN 'ALTER ROLE %I WITH LOGIN PASSWORD %L'
        ELSE 'CREATE ROLE %I WITH LOGIN PASSWORD %L'
      END,
      $1::text,
      $2::text
    ) AS stmt
    `,
    [config.user, config.password],
  );
  await admin.query(roleRows[0].stmt);

  const { rows } = await admin.query<{ stmt: string }>(
    `
    SELECT format('CREATE DATABASE %I OWNER %I', $1::text, $2::text) AS stmt
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = $1::text)
    `,
    [config.database, config.user],
  );

  if (rows[0]?.stmt) {
    await admin.query(rows[0].stmt);
  }

  await admin.end();

  const app = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
  });

  await app.connect();

  await app.query(`GRANT ALL PRIVILEGES ON DATABASE "${config.database}" TO "${config.user}"`);
  await app.query(`GRANT ALL ON SCHEMA public TO "${config.user}"`);
  await app.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${config.user}"`,
  );
  await app.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${config.user}"`,
  );

  await app.end();
}
