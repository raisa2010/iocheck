import { Client, type ClientConfig } from 'pg';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  adminUser: string;
  adminPassword: string;
}

function readEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`${name} is required`);
}

export function getDatabaseConfig(): DatabaseConfig {
  const isTest = process.env.NODE_ENV === 'test';
  const host = process.env.POSTGRES_HOST ?? 'localhost';
  const isRemote = host !== 'localhost' && host !== '127.0.0.1';

  const user = isRemote
    ? readEnv('POSTGRES_USER')
    : readEnv('POSTGRES_USER', 'strongkeep');
  const password = isRemote
    ? readEnv('POSTGRES_PASSWORD')
    : readEnv('POSTGRES_PASSWORD', 'postgres');
  const database = isRemote
    ? readEnv('POSTGRES_DB')
    : readEnv('POSTGRES_DB', isTest ? 'myapp-test' : 'myapp');

  return {
    host,
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database,
    user,
    password,
    adminUser: readEnv('POSTGRES_ADMIN_USER', isRemote ? user : process.env.USER ?? 'postgres'),
    adminPassword: readEnv(
      'POSTGRES_ADMIN_PASSWORD',
      isRemote ? password : '',
    ),
  };
}

function createClient(config: ClientConfig): Client {
  return new Client({
    connectionTimeoutMillis: 10_000,
    ...config,
  });
}

/** Mirrors api/postgres/init.sql — ensures role, database, and grants exist. */
export async function setupDatabase(config: DatabaseConfig = getDatabaseConfig()): Promise<void> {
  const admin = createClient({
    host: config.host,
    port: config.port,
    user: config.adminUser,
    password: config.adminPassword,
    database: 'template1',
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

  const app = createClient({
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
