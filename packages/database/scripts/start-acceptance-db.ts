import { startDisposableMysql } from './disposable-mysql.js';

const mysql = await startDisposableMysql();
process.stdout.write(
  `Acceptance MySQL 8.1.0 ready: ${mysql.connectionString}\n`,
);

let stopping = false;
const stop = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  await mysql.stop();
  process.exitCode = 0;
};

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

await new Promise<void>((resolve) => {
  process.once('beforeExit', resolve);
});
