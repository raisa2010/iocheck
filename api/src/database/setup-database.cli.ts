import { getDatabaseConfig, setupDatabase } from './setup-database';

async function main(): Promise<void> {
  const config = getDatabaseConfig();
  await setupDatabase(config);
  console.log(
    `Database ready: ${config.user}@${config.host}:${config.port}/${config.database}`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Database setup failed: ${message}`);
  process.exit(1);
});
