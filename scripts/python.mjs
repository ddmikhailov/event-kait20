import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

for (const [command, prefix] of candidates) {
  const version = spawnSync(command, [...prefix, '--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (
    version.status !== 0 ||
    !`${version.stdout}${version.stderr}`.includes('3.12.')
  )
    continue;
  const result = spawnSync(command, [...prefix, ...process.argv.slice(2)], {
    stdio: 'inherit',
    windowsHide: true,
  });
  process.exit(result.status ?? 1);
}

console.error('Python 3.12 is required. Install it and retry.');
process.exit(1);
