import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, platform, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createConnection, type RowDataPacket } from 'mysql2/promise';

const MYSQL_VERSION = '8.1.0';
const MYSQL_ARCHIVE = `mysql-${MYSQL_VERSION}-winx64.zip`;
const MYSQL_ARCHIVE_URL = `https://cdn.mysql.com/archives/mysql-8.1/${MYSQL_ARCHIVE}`;
const MYSQL_ARCHIVE_SHA256 =
  '31283e2e2712d35043f0c72ada09cafde5a9f367849e9da93a9bcadf41325b81';
const TEST_DATABASE_NAME = 'event_registration_test';

export type DisposableMysql = {
  connectionString: string;
  stop: () => Promise<void>;
};

const runBinary = async (
  executable: string,
  arguments_: string[],
): Promise<{ output: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      env: { ...process.env },
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve({ output });
        return;
      }
      reject(
        new Error(
          `${basename(executable)} failed with code ${String(code)} and signal ${String(signal)}.\n${output}`,
        ),
      );
    });
  });

const fileSha256 = async (path: string): Promise<string> => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};

const download = async (url: string, destination: string): Promise<void> => {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(
      `Could not download MySQL ${MYSQL_VERSION}: HTTP ${String(response.status)}`,
    );
  }
  await writeFile(destination, Buffer.from(await response.arrayBuffer()), {
    flag: 'wx',
  });
};

const ensureBinary = async (): Promise<string> => {
  const explicit = process.env.MYSQL_TEST_BINARY_DIR;
  if (explicit) {
    await access(
      join(explicit, 'bin', platform() === 'win32' ? 'mysqld.exe' : 'mysqld'),
    );
    return explicit;
  }
  if (platform() !== 'win32') {
    throw new Error(
      'Set MYSQL_TEST_BINARY_DIR to an unpacked MySQL 8.1.0 distribution on this platform',
    );
  }

  const cacheRoot = join(
    process.env.LOCALAPPDATA ?? join(homedir(), '.cache'),
    'event-registration-test',
  );
  const binaryRoot = join(cacheRoot, `mysql-${MYSQL_VERSION}-winx64`);
  const server = join(binaryRoot, 'bin', 'mysqld.exe');
  try {
    await access(server);
    return binaryRoot;
  } catch {
    // Prepared below.
  }

  await mkdir(cacheRoot, { recursive: true });
  const archive = join(cacheRoot, MYSQL_ARCHIVE);
  try {
    await access(archive);
  } catch {
    await download(MYSQL_ARCHIVE_URL, archive);
  }
  const checksum = await fileSha256(archive);
  if (checksum !== MYSQL_ARCHIVE_SHA256) {
    throw new Error(
      `MySQL ${MYSQL_VERSION} archive checksum mismatch: ${checksum}`,
    );
  }
  await runBinary('tar.exe', ['-xf', archive, '-C', cacheRoot]);
  await access(server);
  return binaryRoot;
};

const reservePort = async (): Promise<number> => {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a local MySQL port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
};

export async function startDisposableMysql(): Promise<DisposableMysql> {
  const binaryRoot = await ensureBinary();
  const mysqld = join(
    binaryRoot,
    'bin',
    platform() === 'win32' ? 'mysqld.exe' : 'mysqld',
  );
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'event-registration-mysql-'),
  );
  const dataDirectory = join(temporaryDirectory, 'data');
  const port = await reservePort();

  try {
    await runBinary(mysqld, [
      '--no-defaults',
      `--basedir=${binaryRoot}`,
      `--datadir=${dataDirectory}`,
      '--initialize-insecure',
      '--console',
    ]);
  } catch (error) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    throw error;
  }

  const server = spawn(
    mysqld,
    [
      '--no-defaults',
      `--basedir=${binaryRoot}`,
      `--datadir=${dataDirectory}`,
      `--port=${String(port)}`,
      '--bind-address=127.0.0.1',
      '--mysqlx=0',
      '--skip-log-bin',
      '--default-time-zone=+00:00',
      '--character-set-server=utf8mb4',
      '--collation-server=utf8mb4_unicode_ci',
      '--console',
    ],
    { windowsHide: true },
  );
  let serverOutput = '';
  server.stdout.on('data', (chunk: Buffer) => {
    serverOutput += chunk.toString('utf8');
  });
  server.stderr.on('data', (chunk: Buffer) => {
    serverOutput += chunk.toString('utf8');
  });

  let admin: Awaited<ReturnType<typeof createConnection>> | undefined;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      admin = await createConnection({
        host: '127.0.0.1',
        port,
        user: 'root',
      });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!admin) {
    server.kill();
    await rm(temporaryDirectory, { force: true, recursive: true });
    throw new Error(`Disposable MySQL did not start.\n${serverOutput}`);
  }

  await admin.query(
    `CREATE DATABASE \`${TEST_DATABASE_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await admin.end();

  return {
    connectionString: `mysql://root@127.0.0.1:${String(port)}/${TEST_DATABASE_NAME}`,
    stop: async () => {
      try {
        const shutdown = await createConnection({
          host: '127.0.0.1',
          port,
          user: 'root',
        });
        await shutdown.query('SHUTDOWN');
        await shutdown.end().catch(() => undefined);
      } catch {
        server.kill();
      }
      await rm(temporaryDirectory, {
        force: true,
        maxRetries: 10,
        recursive: true,
        retryDelay: 100,
      });
    },
  };
}

export const assertMysql81 = async (
  connectionString: string,
): Promise<void> => {
  const connection = await createConnection(connectionString);
  try {
    const [rows] = await connection.query<
      Array<RowDataPacket & { version: string }>
    >('SELECT VERSION() AS version');
    const version = rows[0]?.version;
    if (!version?.startsWith(MYSQL_VERSION)) {
      throw new Error(
        `Integration tests require MySQL ${MYSQL_VERSION}; version=${String(version)}`,
      );
    }
  } finally {
    await connection.end();
  }
};

export const resetTestDatabase = async (
  connectionString: string,
): Promise<void> => {
  const url = new URL(connectionString);
  const databaseName = url.pathname.slice(1);
  if (
    url.protocol !== 'mysql:' ||
    !new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname) ||
    !databaseName.endsWith('_test')
  ) {
    throw new Error(
      'TEST_DATABASE_URL must point to a local MySQL database ending in _test',
    );
  }
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = '/';
  const connection = await createConnection(adminUrl.toString());
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    await connection.query(
      `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await connection.end();
  }
};
