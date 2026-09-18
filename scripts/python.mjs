import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const virtualEnvironment = resolve(
  'backend',
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
const candidates = existsSync(virtualEnvironment)
  ? [[virtualEnvironment, []]]
  : process.platform === 'win32'
    ? [
        ['py', ['-3.12']],
        ['python', []],
      ]
    : [
        ['python3.12', []],
        ['python3', []],
      ];

const repairWindowsEditablePath = () => {
  if (process.platform !== 'win32' || !existsSync(virtualEnvironment)) return;
  const sitePackages = resolve('backend', '.venv', 'Lib', 'site-packages');
  if (!existsSync(sitePackages)) return;
  for (const name of readdirSync(sitePackages)) {
    if (!/^_editable_impl_.*\.pth$/.test(name)) continue;
    const path = resolve(sitePackages, name);
    const source = readFileSync(path, 'utf8').trim();
    if (!source || /^[\x00-\x7F]*$/.test(source)) continue;
    const literal = JSON.stringify(source).replace(
      /[^\x00-\x7F]/g,
      (character) =>
        `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    writeFileSync(
      path,
      `import sys; sys.path.insert(0, ${literal})\n`,
      'ascii',
    );
  }
};

repairWindowsEditablePath();

const pythonEnvironment =
  process.platform === 'win32'
    ? { ...process.env, PYTHONUTF8: process.env.PYTHONUTF8 ?? '1' }
    : process.env;

for (const [command, prefix] of candidates) {
  const version = spawnSync(command, [...prefix, '--version'], {
    encoding: 'utf8',
    env: pythonEnvironment,
    windowsHide: true,
  });
  if (
    version.status !== 0 ||
    !`${version.stdout}${version.stderr}`.includes('3.12.')
  )
    continue;
  const result = spawnSync(command, [...prefix, ...process.argv.slice(2)], {
    env: pythonEnvironment,
    stdio: 'inherit',
    windowsHide: true,
  });
  process.exit(result.status ?? 1);
}

console.error('Python 3.12 is required. Install it and retry.');
process.exit(1);
