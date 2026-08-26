import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const envFile = '.demo.env';
if (!existsSync(envFile)) {
  const secret = () => randomBytes(32).toString('base64url');
  const password = () => `Demo-${randomBytes(12).toString('base64url')}!`;
  writeFileSync(
    envFile,
    [
      `MYSQL_ROOT_PASSWORD=${secret()}`,
      `SESSION_SECRET=${secret()}`,
      `AUTH_LINK_SECRET=${secret()}`,
      `QR_SIGNING_SECRET=${secret()}`,
      'DEMO_ADMIN_EMAIL=admin@demo.example.com',
      `DEMO_ADMIN_PASSWORD=${password()}`,
      'DEMO_SCANNER_EMAIL=scanner@demo.example.com',
      `DEMO_SCANNER_PASSWORD=${password()}`,
      '',
    ].join('\n'),
    { encoding: 'utf8', mode: 0o600 },
  );
}

const action = process.argv[2] ?? 'up';
const common = ['compose', '--env-file', envFile, '-f', 'compose.demo.yml'];
const args =
  action === 'down'
    ? [...common, 'down']
    : action === 'reset'
      ? [...common, 'down', '--volumes']
      : [...common, 'up', '--build', '--detach', '--wait'];
const result = spawnSync('docker', args, {
  stdio: 'inherit',
  windowsHide: true,
});
if (result.status !== 0) process.exit(result.status ?? 1);

if (action === 'up') {
  const values = Object.fromEntries(
    readFileSync(envFile, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
  console.log('\nLocal MVP is ready:');
  console.log('Web/Admin: http://localhost:5173');
  console.log('Scanner:   http://localhost:5174');
  console.log('API:       http://localhost:3000/health/ready');
  console.log(
    `Admin:     ${values.DEMO_ADMIN_EMAIL} / ${values.DEMO_ADMIN_PASSWORD}`,
  );
  console.log(
    `Scanner:   ${values.DEMO_SCANNER_EMAIL} / ${values.DEMO_SCANNER_PASSWORD}`,
  );
}
