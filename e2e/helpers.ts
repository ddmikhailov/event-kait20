import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const demoCredentials = () => {
  const values = Object.fromEntries(
    readFileSync(resolve(process.cwd(), '.demo.env'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
  const required = (name: string) => {
    const value = values[name];
    if (!value)
      throw new Error(`Missing ${name} in the local demo environment`);
    return value;
  };
  return {
    adminEmail: required('DEMO_ADMIN_EMAIL'),
    adminPassword: required('DEMO_ADMIN_PASSWORD'),
    scannerEmail: required('DEMO_SCANNER_EMAIL'),
    scannerPassword: required('DEMO_SCANNER_PASSWORD'),
  };
};
