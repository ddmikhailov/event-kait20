import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { arch, platform, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Client } from 'pg';

const TEST_DATABASE_NAME = 'event_registration_test';
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

type PostgresBinaryModule = {
  initdb: string;
  pg_ctl: string;
};

type DisposablePostgres = {
  connectionString: string;
  stop: () => Promise<void>;
};

const reservePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a local PostgreSQL port'));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });

const postgresBinaryPackage = (): string => {
  const key = `${platform()}-${arch()}`;
  const packages: Record<string, string> = {
    'darwin-arm64': '@embedded-postgres/darwin-arm64',
    'darwin-x64': '@embedded-postgres/darwin-x64',
    'linux-arm64': '@embedded-postgres/linux-arm64',
    'linux-x64': '@embedded-postgres/linux-x64',
    'win32-x64': '@embedded-postgres/windows-x64',
  };
  const packageName = packages[key];

  if (!packageName) {
    throw new Error(`Unsupported disposable PostgreSQL platform: ${key}`);
  }

  return packageName;
};

const runBinary = async (
  executable: string,
  arguments_: string[],
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      env: { ...process.env, LC_MESSAGES: 'C' },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `PostgreSQL command failed with code ${String(code)} and signal ${String(signal)}.\n${stdout}\n${stderr}`,
        ),
      );
    });
  });

const startDisposablePostgres = async (): Promise<DisposablePostgres> => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'event-registration-postgres-'),
  );
  const removeTemporaryDirectory = async (): Promise<void> =>
    rm(temporaryDirectory, {
      force: true,
      maxRetries: 10,
      recursive: true,
      retryDelay: 100,
    });
  const runtimeDirectory = join(temporaryDirectory, 'runtime');
  const dataDirectory = join(temporaryDirectory, 'data');
  const passwordFile = join(temporaryDirectory, 'password.txt');
  const embeddedPostgresEntry = import.meta.resolve('embedded-postgres');
  const requireFromEmbeddedPostgres = createRequire(embeddedPostgresEntry);
  const binaryEntry = requireFromEmbeddedPostgres.resolve(
    postgresBinaryPackage(),
  );
  const binaryModule = (await import(
    pathToFileURL(binaryEntry).href
  )) as PostgresBinaryModule;
  const sourceNativeDirectory = dirname(dirname(binaryModule.initdb));

  // PostgreSQL discovers its share/lib directories relative to the executable.
  // Copying the runtime to the OS temp directory also avoids Windows MAX_PATH
  // failures caused by deeply nested pnpm store paths.
  await cp(sourceNativeDirectory, runtimeDirectory, { recursive: true });

  const initdb = join(runtimeDirectory, 'bin', basename(binaryModule.initdb));
  const pgControl = join(
    runtimeDirectory,
    'bin',
    basename(binaryModule.pg_ctl),
  );
  const postgres = join(
    runtimeDirectory,
    'bin',
    platform() === 'win32' ? 'postgres.exe' : 'postgres',
  );
  const port = await reservePort();
  const user = 'postgres';
  const password = randomBytes(24).toString('hex');

  await Promise.all([
    chmod(initdb, 0o755),
    chmod(pgControl, 0o755),
    chmod(postgres, 0o755),
  ]);
  await mkdir(dataDirectory);
  await writeFile(passwordFile, `${password}\n`, { mode: 0o600 });

  try {
    await runBinary(initdb, [
      `--pgdata=${dataDirectory}`,
      '--auth=scram-sha-256',
      `--username=${user}`,
      `--pwfile=${passwordFile}`,
      '--encoding=UTF8',
      '--no-locale',
    ]);
  } catch (error) {
    await removeTemporaryDirectory();
    throw error;
  } finally {
    await unlink(passwordFile).catch(() => undefined);
  }

  const adminConnectionString = `postgresql://${user}:${password}@127.0.0.1:${port}/postgres`;
  const server = spawn(
    postgres,
    ['-D', dataDirectory, '-p', String(port), '-h', '127.0.0.1'],
    {
      env: { ...process.env, LC_MESSAGES: 'C' },
      windowsHide: true,
    },
  );
  let serverOutput = '';
  let serverExit: string | undefined;
  let resolveServerExit: () => void = () => undefined;
  const serverExited = new Promise<void>((resolve) => {
    resolveServerExit = resolve;
  });

  server.stdout.on('data', (chunk: Buffer) => {
    serverOutput += chunk.toString('utf8');
  });
  server.stderr.on('data', (chunk: Buffer) => {
    serverOutput += chunk.toString('utf8');
  });
  server.once('exit', (code, signal) => {
    serverExit = `code ${String(code)}, signal ${String(signal)}`;
    resolveServerExit();
  });

  const stopServer = async (): Promise<void> => {
    await runBinary(pgControl, [
      '-D',
      dataDirectory,
      '-m',
      'fast',
      '-w',
      'stop',
    ]).catch(() => {
      server.kill();
    });
    await serverExited;
  };

  let ready = false;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (serverExit) {
      break;
    }

    const readinessClient = new Client({
      connectionString: adminConnectionString,
    });

    try {
      await readinessClient.connect();
      ready = true;
      await readinessClient.end();
      break;
    } catch {
      await readinessClient.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  if (!ready) {
    await stopServer();
    await removeTemporaryDirectory();
    throw new Error(
      `Disposable PostgreSQL did not become ready (${serverExit ?? 'timeout'}).\n${serverOutput}`,
    );
  }

  const client = new Client({ connectionString: adminConnectionString });

  try {
    await client.connect();
    await client.query(`CREATE DATABASE ${TEST_DATABASE_NAME}`);
  } catch (error) {
    await stopServer();
    await removeTemporaryDirectory();
    throw error;
  } finally {
    await client.end();
  }

  return {
    connectionString: `postgresql://${user}:${password}@127.0.0.1:${port}/${TEST_DATABASE_NAME}`,
    stop: async () => {
      await stopServer()
        .catch(() => undefined)
        .finally(async () => {
          await removeTemporaryDirectory();
        });
    },
  };
};

const validateExternalTestUrl = (connectionString: string): void => {
  const url = new URL(connectionString);
  const databaseName = url.pathname.slice(1);
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('TEST_DATABASE_URL must use the PostgreSQL protocol');
  }

  if (!localHosts.has(url.hostname)) {
    throw new Error(
      'TEST_DATABASE_URL must point to a local disposable server',
    );
  }

  if (!databaseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL database name must end with _test');
  }
};

const resetExternalTestDatabase = async (
  connectionString: string,
): Promise<void> => {
  validateExternalTestUrl(connectionString);
  const client = new Client({ connectionString });

  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
};

const runPnpm = async (
  arguments_: string[],
  databaseUrl: string,
): Promise<void> => {
  const pnpmScript = process.env.npm_execpath;

  if (!pnpmScript) {
    throw new Error(
      'npm_execpath is required to run the database test commands',
    );
  }

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
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Command failed with code ${String(code)} and signal ${String(signal)}`,
        ),
      );
    });
  });
};

const run = async (): Promise<void> => {
  let disposablePostgres: DisposablePostgres | undefined;
  let databaseUrl = process.env.TEST_DATABASE_URL;

  try {
    if (databaseUrl) {
      await resetExternalTestDatabase(databaseUrl);
    } else {
      disposablePostgres = await startDisposablePostgres();
      databaseUrl = disposablePostgres.connectionString;
    }

    await runPnpm(['exec', 'prisma', 'validate'], databaseUrl);
    await runPnpm(['exec', 'prisma', 'migrate', 'deploy'], databaseUrl);
    await runPnpm(
      [
        'exec',
        'vitest',
        'run',
        'tests/integration/database.integration.test.ts',
      ],
      databaseUrl,
    );
    await resetExternalTestDatabase(databaseUrl);
    await runPnpm(['exec', 'prisma', 'migrate', 'deploy'], databaseUrl);
    await runPnpm(['--dir', '../config', 'run', 'build'], databaseUrl);
    await runPnpm(['--dir', '../contracts', 'run', 'build'], databaseUrl);
    await runPnpm(
      ['--dir', '../../apps/api', 'run', 'test:integration'],
      databaseUrl,
    );
  } finally {
    await disposablePostgres?.stop();
  }
};

await run();
