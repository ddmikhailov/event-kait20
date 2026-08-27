import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const runtime = join(root, '.runtime');
const output = join(runtime, 'sysadmin-release');
const archive = join(runtime, 'event-registration-1.0.0-sysadmin.tar.gz');
const wheelSource = join(runtime, 'wheel-source');
const tar = process.platform === 'win32' ? 'tar.exe' : 'tar';

const run = (command, args, extra = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    ...extra,
  });
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status})`);
};

const runPnpm = (args, extra = {}) => {
  if (process.platform === 'win32') {
    run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'pnpm', ...args], extra);
  } else run('pnpm', args, extra);
};

if (relative(runtime, output).startsWith('..'))
  throw new Error('unsafe output path');
await rm(output, { recursive: true, force: true });
await rm(archive, { force: true });
await rm(wheelSource, { recursive: true, force: true });
await mkdir(join(output, 'backend'), { recursive: true });
await mkdir(join(output, 'config'), { recursive: true });
await mkdir(wheelSource, { recursive: true });

const buildEnv = { ...process.env, VITE_API_BASE_URL: '/api' };
runPnpm(['--filter', '@event-registration/web', 'build'], {
  env: buildEnv,
});
runPnpm(['--filter', '@event-registration/scanner', 'build'], {
  env: buildEnv,
});
run(process.execPath, [
  'scripts/python.mjs',
  '-m',
  'pip',
  'wheel',
  '--no-deps',
  '--no-build-isolation',
  join(root, 'backend'),
  '--wheel-dir',
  wheelSource,
]);
const sourceWheels = (await readdir(wheelSource)).filter((name) =>
  name.endsWith('.whl'),
);
if (sourceWheels.length !== 1)
  throw new Error('expected exactly one backend wheel');
run(process.execPath, [
  'scripts/python.mjs',
  'scripts/compile-backend-wheel.py',
  join(wheelSource, sourceWheels[0]),
  join(output, 'backend'),
]);
await rm(wheelSource, { recursive: true, force: true });

await cp(join(root, 'apps/web/dist'), join(output, 'frontend/web'), {
  recursive: true,
});
await cp(join(root, 'apps/scanner/dist'), join(output, 'frontend/scanner'), {
  recursive: true,
});
await cp(join(root, 'release/sysadmin/README.txt'), join(output, 'README.txt'));
await cp(
  join(root, 'release/sysadmin/backend-requirements.txt'),
  join(output, 'backend/requirements.txt'),
);
await cp(
  join(root, 'release/sysadmin/backend.env.example'),
  join(output, 'config/backend.env.example'),
);
await cp(join(root, 'release/sysadmin/apache'), join(output, 'apache'), {
  recursive: true,
});
await cp(join(root, 'release/sysadmin/database'), join(output, 'database'), {
  recursive: true,
});
await cp(
  join(root, 'backend/migrations'),
  join(output, 'database/migrations'),
  { recursive: true },
);

const migrationDir = join(root, 'backend/migrations');
const migrations = (await readdir(migrationDir))
  .filter((name) => name.endsWith('.sql'))
  .sort();
const migrationSources = [];
const registryRows = [];
for (const name of migrations) {
  const source = await readFile(join(migrationDir, name), 'utf8');
  migrationSources.push(`-- BEGIN ${name}\n${source.trim()}\n-- END ${name}`);
  registryRows.push(
    `('${name}','${createHash('sha256').update(source).digest('hex')}')`,
  );
}
const schema = [
  '-- Generated new-database template for MySQL 8.1.0. Do not edit applied migrations.',
  'USE `event_registration`;',
  ...migrationSources,
  'CREATE TABLE IF NOT EXISTS `schema_migrations` (`name` VARCHAR(255) PRIMARY KEY, `checksum` CHAR(64) NOT NULL, `applied_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3));',
  `INSERT INTO \`schema_migrations\` (\`name\`,\`checksum\`) VALUES\n${registryRows.join(',\n')};`,
  '',
].join('\n\n');
await writeFile(join(output, 'database/01_schema.sql'), schema, 'utf8');

const files = [];
const walk = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push(path);
  }
};
await walk(output);
const sourceRevision = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).stdout.trim();
const manifest = {
  product: 'Event Registration System',
  version: '1.0.0',
  sourceRevision,
  databaseTarget: 'MySQL 8.1.0',
  files: Object.fromEntries(
    await Promise.all(
      files.sort().map(async (path) => [
        relative(output, path).replaceAll('\\', '/'),
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      ]),
    ),
  ),
};
await writeFile(
  join(output, 'MANIFEST.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

run(tar, ['-czf', archive, '-C', runtime, 'sysadmin-release']);
console.log(`Release directory: ${output}`);
console.log(`Release archive: ${archive}`);
