import { startDisposablePostgres } from './run-integration-tests.js';

const postgres = await startDisposablePostgres();
process.stdout.write(
  `Acceptance PostgreSQL 18 ready: ${postgres.connectionString}\n`,
);

let stopping = false;
const stop = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  await postgres.stop();
  process.exitCode = 0;
};

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

await new Promise<void>((resolve) => {
  process.once('beforeExit', resolve);
});
