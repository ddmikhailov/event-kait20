import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const runtime = resolve(root, '.runtime', 'native-demo');
const dataDirectory = join(runtime, 'mysql-data');
const pidFile = join(runtime, 'controller.pid');
const mysqlInitFile = join(runtime, 'mysql-init.sql');
const envFile = resolve(root, '.demo.env');
const mysqlPort = 3307;
const processes = [];
let stopping = false;

const fail = (message) => {
  console.error(`\n${message}`);
  for (const child of processes.toReversed()) stopTree(child.pid);
  if (existsSync(pidFile)) rmSync(pidFile, { force: true });
  if (existsSync(mysqlInitFile)) rmSync(mysqlInitFile, { force: true });
  process.exit(1);
};

const safeRuntimePath = (path) => {
  const part = relative(root, path);
  if (!part || part.startsWith('..') || !part.startsWith('.runtime')) {
    throw new Error(`Refusing to modify an unsafe runtime path: ${path}`);
  }
};

const parseEnv = (source) =>
  Object.fromEntries(
    source
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );

const ensureEnvironment = () => {
  if (!existsSync(envFile)) {
    const secret = () => randomBytes(32).toString('base64url');
    const password = () => `Demo-${randomBytes(18).toString('base64url')}`;
    writeFileSync(
      envFile,
      [
        `MYSQL_APP_PASSWORD=${password()}`,
        `SESSION_SECRET=${secret()}`,
        `AUTH_LINK_SECRET=${secret()}`,
        `QR_SIGNING_SECRET=${secret()}`,
        'DEMO_ADMIN_EMAIL=admin@demo.example.com',
        `DEMO_ADMIN_PASSWORD=${password()}!`,
        'DEMO_SCANNER_EMAIL=scanner@demo.example.com',
        `DEMO_SCANNER_PASSWORD=${password()}!`,
        '',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600 },
    );
  }
  return parseEnv(readFileSync(envFile, 'utf8'));
};

const findPython = () => {
  const virtual = resolve(
    root,
    'backend',
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  const candidates = existsSync(virtual)
    ? [[virtual, []]]
    : process.platform === 'win32'
      ? [
          ['py', ['-3.12']],
          ['python', []],
        ]
      : [
          ['python3.12', []],
          ['python3', []],
        ];
  for (const [command, prefix] of candidates) {
    const result = spawnSync(command, [...prefix, '--version'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (`${result.stdout}${result.stderr}`.includes('3.12.')) {
      return { command, prefix };
    }
  }
  fail('Python 3.12 is required. Install it and run pnpm backend:install.');
};

const findMysql = () => {
  const executable = process.platform === 'win32' ? 'mysqld.exe' : 'mysqld';
  const client = process.platform === 'win32' ? 'mysql.exe' : 'mysql';
  const homes = [
    process.env.MYSQL_HOME,
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? join(
          process.env.LOCALAPPDATA,
          'event-registration-test',
          'mysql-8.1.0-winx64',
        )
      : undefined,
    process.platform === 'win32'
      ? 'C:\\Program Files\\MySQL\\MySQL Server 8.1'
      : '/opt/mysql-8.1.0',
  ].filter(Boolean);
  for (const home of homes) {
    const server = [
      join(home, 'bin', executable),
      join(home, 'sbin', executable),
    ].find(existsSync);
    const mysql = join(home, 'bin', client);
    if (!server || !existsSync(mysql)) continue;
    const version = spawnSync(server, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (`${version.stdout}${version.stderr}`.includes('Ver 8.1.0')) {
      return { home, server, client: mysql };
    }
  }
  fail(
    'MySQL 8.1.0 was not found. Set MYSQL_HOME to the extracted official MySQL 8.1.0 directory.',
  );
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    env: options.env ?? process.env,
    input: options.input,
    stdio: options.input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) {
    fail(
      `${options.label ?? command} failed with exit code ${result.status ?? 1}.`,
    );
  }
};

const stopTree = (pid) => {
  if (!pid || pid === process.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // It is already stopped.
    }
  }
};

const isDemoController = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  let commandLine = '';
  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    if (result.status === 0) commandLine = result.stdout;
  } else {
    const commandFile = `/proc/${pid}/cmdline`;
    if (existsSync(commandFile)) {
      commandLine = readFileSync(commandFile, 'utf8').replaceAll('\0', ' ');
    }
  }
  return commandLine.includes('native-demo.mjs') && commandLine.includes(' up');
};

const stop = async (exitCode = 0) => {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping native demo...');
  for (const child of processes.toReversed()) stopTree(child.pid);
  if (existsSync(pidFile)) rmSync(pidFile, { force: true });
  if (existsSync(mysqlInitFile)) rmSync(mysqlInitFile, { force: true });
  setTimeout(() => process.exit(exitCode), 250).unref();
};

const spawnManaged = (name, command, args, env, output = 'inherit') => {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: output,
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  child.demoName = name;
  processes.push(child);
  child.once('exit', (code) => {
    if (!stopping) {
      console.error(
        `${name} stopped unexpectedly (exit ${code ?? 'unknown'}).`,
      );
      void stop(code || 1);
    }
  });
  return child;
};

const mysqlClient = (mysql, values, sql) => {
  const env = {
    ...process.env,
    MYSQL_PWD: values.MYSQL_APP_PASSWORD,
  };
  return spawnSync(
    mysql.client,
    [
      '--protocol=tcp',
      '--host=127.0.0.1',
      `--port=${mysqlPort}`,
      '--user=event_app',
      '--batch',
      '--skip-column-names',
    ],
    { cwd: root, env, input: sql, encoding: 'utf8', windowsHide: true },
  );
};

const waitForMysql = async (mysql, values) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const probe = mysqlClient(mysql, values, 'SELECT VERSION();');
    if (probe.status === 0) {
      const version = probe.stdout.trim();
      if (!version.startsWith('8.1.0')) {
        fail(`MySQL 8.1.0 is required; found ${version}.`);
      }
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  fail(`MySQL did not become ready. See ${join(runtime, 'mysql.log')}.`);
};

const startMysql = async (mysql, values) => {
  mkdirSync(runtime, { recursive: true });
  const fresh = !existsSync(join(dataDirectory, 'mysql'));
  const layoutOptions = [];
  const messages = join(mysql.home, 'share', 'mysql-8.1');
  const plugins = join(mysql.home, 'lib', 'mysql', 'plugin');
  if (existsSync(messages)) layoutOptions.push(`--lc-messages-dir=${messages}`);
  if (existsSync(plugins)) layoutOptions.push(`--plugin-dir=${plugins}`);
  const platformOptions =
    process.platform === 'win32'
      ? []
      : [`--socket=${join(runtime, 'mysql.sock')}`];
  if (fresh) {
    mkdirSync(dataDirectory, { recursive: true });
    run(
      mysql.server,
      [
        '--no-defaults',
        `--basedir=${mysql.home}`,
        `--datadir=${dataDirectory}`,
        ...layoutOptions,
        '--initialize-insecure',
        '--console',
      ],
      { label: 'MySQL initialization' },
    );
  }
  if (fresh) {
    const escapedRoot = `Demo-${randomBytes(32).toString('base64url')}`;
    const escapedApp = values.MYSQL_APP_PASSWORD.replaceAll("'", "''");
    writeFileSync(
      mysqlInitFile,
      [
        `ALTER USER 'root'@'localhost' IDENTIFIED BY '${escapedRoot}';`,
        'CREATE DATABASE event_registration_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',
        `CREATE USER 'event_app'@'localhost' IDENTIFIED BY '${escapedApp}';`,
        `CREATE USER 'event_app'@'127.0.0.1' IDENTIFIED BY '${escapedApp}';`,
        "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON event_registration_demo.* TO 'event_app'@'localhost';",
        "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON event_registration_demo.* TO 'event_app'@'127.0.0.1';",
        'FLUSH PRIVILEGES;',
        '',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600 },
    );
  }
  const log = openSync(join(runtime, 'mysql.log'), 'a');
  const child = spawnManaged(
    'MySQL 8.1.0',
    mysql.server,
    [
      '--no-defaults',
      `--basedir=${mysql.home}`,
      `--datadir=${dataDirectory}`,
      ...layoutOptions,
      ...platformOptions,
      `--port=${mysqlPort}`,
      '--bind-address=127.0.0.1',
      '--mysqlx=0',
      '--skip-log-bin',
      '--skip-name-resolve',
      '--local-infile=OFF',
      '--secure-file-priv=NULL',
      '--default-time-zone=+00:00',
      '--character-set-server=utf8mb4',
      '--collation-server=utf8mb4_unicode_ci',
      ...(fresh ? [`--init-file=${mysqlInitFile}`] : []),
      '--console',
    ],
    process.env,
    ['ignore', log, log],
  );
  child.once('exit', () => closeSync(log));
  await waitForMysql(mysql, values);
  if (existsSync(mysqlInitFile)) rmSync(mysqlInitFile, { force: true });
  const appProbe = mysqlClient(mysql, values, 'SELECT VERSION();');
  if (appProbe.status !== 0 || !appProbe.stdout.trim().startsWith('8.1.0')) {
    fail(
      'The dedicated demo database account could not connect to MySQL 8.1.0.',
    );
  }
};

const waitForHttp = async (url) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  fail(`Service did not become ready: ${url}`);
};

const start = async () => {
  if (existsSync(pidFile)) {
    fail(
      'The native demo already appears to be running. Use pnpm demo:down first.',
    );
  }
  const values = ensureEnvironment();
  const python = findPython();
  const mysql = findMysql();
  mkdirSync(runtime, { recursive: true });
  writeFileSync(pidFile, String(process.pid), {
    encoding: 'utf8',
    mode: 0o600,
  });
  process.on('SIGINT', () => void stop(0));
  process.on('SIGTERM', () => void stop(0));
  process.on('uncaughtException', (error) => {
    console.error(error);
    void stop(1);
  });

  await startMysql(mysql, values);
  const environment = {
    ...process.env,
    ...values,
    NODE_ENV: 'development',
    DATABASE_URL: `mysql://event_app:${values.MYSQL_APP_PASSWORD}@127.0.0.1:${mysqlPort}/event_registration_demo`,
    CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174',
    AUTH_LINK_BASE_URL: 'http://localhost:5173/auth/',
    PUBLIC_WEB_BASE_URL: 'http://localhost:5173',
    CONSENT_URL: 'http://localhost:5173/consent',
    CONSENT_VERSION: 'demo-v1',
    VITE_API_BASE_URL: 'http://localhost:3000',
  };
  const pythonArgs = (args) => [...python.prefix, ...args];
  run(python.command, pythonArgs(['-c', 'import event_api, fastapi']), {
    env: environment,
    label: 'Backend dependency check (run pnpm backend:install if it fails)',
  });
  run(python.command, pythonArgs(['-m', 'event_api.migrate']), {
    env: environment,
    label: 'Database migrations',
  });
  run(python.command, pythonArgs(['-m', 'event_api.demo_seed']), {
    env: environment,
    label: 'Demo seed',
  });

  spawnManaged(
    'API',
    python.command,
    pythonArgs([
      '-m',
      'uvicorn',
      'event_api.main:app',
      '--host',
      '127.0.0.1',
      '--port',
      '3000',
    ]),
    environment,
  );
  spawnManaged(
    'Email worker',
    python.command,
    pythonArgs(['-m', 'event_api.email_worker']),
    environment,
  );
  const vite = (application) =>
    resolve(
      root,
      'apps',
      application,
      'node_modules',
      'vite',
      'bin',
      'vite.js',
    );
  run(process.execPath, [vite('web'), 'build', 'apps/web'], {
    env: environment,
    label: 'Web production build',
  });
  run(process.execPath, [vite('scanner'), 'build', 'apps/scanner'], {
    env: environment,
    label: 'Scanner production build',
  });
  spawnManaged(
    'Web',
    process.execPath,
    [
      vite('web'),
      'preview',
      'apps/web',
      '--host',
      '127.0.0.1',
      '--port',
      '5173',
    ],
    environment,
  );
  spawnManaged(
    'Scanner',
    process.execPath,
    [
      vite('scanner'),
      'preview',
      'apps/scanner',
      '--host',
      '127.0.0.1',
      '--port',
      '5174',
    ],
    environment,
  );
  await Promise.all([
    waitForHttp('http://127.0.0.1:3000/health/ready'),
    waitForHttp('http://127.0.0.1:5173'),
    waitForHttp('http://127.0.0.1:5174'),
  ]);

  console.log('\nLocal MVP is ready without Docker:');
  console.log('Web/Admin: http://localhost:5173');
  console.log('Scanner:   http://localhost:5174');
  console.log('API:       http://localhost:3000/health/ready');
  if (process.env.DEMO_PRINT_CREDENTIALS !== 'false') {
    console.log(
      `Admin:     ${values.DEMO_ADMIN_EMAIL} / ${values.DEMO_ADMIN_PASSWORD}`,
    );
    console.log(
      `Scanner:   ${values.DEMO_SCANNER_EMAIL} / ${values.DEMO_SCANNER_PASSWORD}`,
    );
  }
  console.log('\nKeep this terminal open. Press Ctrl+C to stop the demo.');
};

const down = () => {
  if (!existsSync(pidFile)) {
    console.log('Native demo is not running.');
    return;
  }
  const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
  if (!isDemoController(pid)) {
    rmSync(pidFile, { force: true });
    console.log(
      'Removed a stale native demo PID file; no process was stopped.',
    );
    return;
  }
  stopTree(pid);
  rmSync(pidFile, { force: true });
  console.log('Native demo stopped. Local database was preserved.');
};

const reset = () => {
  down();
  safeRuntimePath(runtime);
  rmSync(runtime, { recursive: true, force: true });
  rmSync(envFile, { force: true });
  console.log('Native demo data and local demo secrets were removed.');
};

const doctor = () => {
  const python = findPython();
  const mysql = findMysql();
  console.log(`Python 3.12: ${python.command}`);
  console.log(`MySQL 8.1.0: ${mysql.home}`);
  console.log('Native demo prerequisites are available.');
};

const action = process.argv[2] ?? 'up';
if (action === 'up') await start();
else if (action === 'down') down();
else if (action === 'reset') reset();
else if (action === 'doctor') doctor();
else fail(`Unknown action: ${action}`);
