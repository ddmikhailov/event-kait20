import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import {
  assertMysql81,
  resetTestDatabase,
  startDisposableMysql,
  type DisposableMysql,
} from './disposable-mysql.js';

const integrationEnvironment = {
  AUTH_LINK_BASE_URL: 'http://127.0.0.1:5173/auth',
  AUTH_LINK_SECRET: randomBytes(32).toString('base64url'),
  AUTH_RATE_LIMIT_MAX: '1000',
  CORS_ORIGINS: 'http://127.0.0.1:5173,http://127.0.0.1:4173',
  NODE_ENV: 'test',
  QR_SIGNING_SECRET: randomBytes(32).toString('base64url'),
  PUBLIC_WEB_BASE_URL: 'http://127.0.0.1:5173',
  CONSENT_URL: 'https://example.test/consent',
  CONSENT_VERSION: 'test-v1',
  SESSION_SECRET: randomBytes(32).toString('base64url'),
};

const runPnpm = async (
  arguments_: string[],
  databaseUrl: string,
): Promise<void> => {
  const pnpmScript = process.env.npm_execpath;
  if (!pnpmScript) throw new Error('npm_execpath is required');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [pnpmScript, ...arguments_], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...integrationEnvironment,
        DATABASE_URL: databaseUrl,
        TEST_DATABASE_URL: databaseUrl,
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Command failed with code ${String(code)} and signal ${String(signal)}`,
          ),
        );
    });
  });
};

const migrate = (databaseUrl: string): Promise<void> =>
  runPnpm(['exec', 'prisma', 'migrate', 'deploy'], databaseUrl);

const run = async (): Promise<void> => {
  let disposable: DisposableMysql | undefined;
  let databaseUrl = process.env.TEST_DATABASE_URL;
  try {
    if (databaseUrl) await resetTestDatabase(databaseUrl);
    else {
      disposable = await startDisposableMysql();
      databaseUrl = disposable.connectionString;
    }
    await assertMysql81(databaseUrl);
    await runPnpm(['exec', 'prisma', 'validate'], databaseUrl);
    await migrate(databaseUrl);
    await runPnpm(
      [
        'exec',
        'vitest',
        'run',
        'tests/integration/database.integration.test.ts',
      ],
      databaseUrl,
    );

    await resetTestDatabase(databaseUrl);
    await migrate(databaseUrl);
    await runPnpm(['run', 'build'], databaseUrl);
    for (const directory of ['../config', '../contracts', '../utils']) {
      await runPnpm(['--dir', directory, 'run', 'build'], databaseUrl);
    }
    await runPnpm(
      ['--dir', '../../apps/api', 'run', 'test:integration'],
      databaseUrl,
    );

    await resetTestDatabase(databaseUrl);
    await migrate(databaseUrl);
    await runPnpm(
      ['--dir', '../../apps/email-worker', 'run', 'test:integration'],
      databaseUrl,
    );
  } finally {
    await disposable?.stop();
  }
};

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await run();
}
