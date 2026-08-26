import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseEnvironment,
  validateDeploymentConfig,
} from './deploy-config.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requiredGateNames = [
  'ci',
  'legalConsent',
  'mysqlRisk',
  'backupRestore',
  'smtpDelivery',
  'deviceE2e',
  'securityReview',
  'rollbackRehearsal',
  'monitoringAlerts',
];
const placeholderPattern =
  /(?:example|replace|change-?me|todo|pending|record ID|run URL)/i;
const secretPattern =
  /(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|mysql:\/\/|smtp:\/\/|password\s*=|secret\s*=|token\s*=|ghp_[A-Za-z0-9]+)/i;

export class ReleaseReadinessError extends Error {}

const assert = (condition, message) => {
  if (!condition) throw new ReleaseReadinessError(message);
};

const safeEvidence = (value, gate) => {
  assert(typeof value === 'string', `${gate} evidence must be text`);
  const normalized = value.trim();
  assert(
    normalized.length >= 4 && normalized.length <= 500,
    `${gate} evidence must contain a short reference`,
  );
  assert(
    !/[\r\n\0]/.test(normalized),
    `${gate} evidence contains control data`,
  );
  assert(
    !placeholderPattern.test(normalized),
    `${gate} evidence is a placeholder`,
  );
  assert(
    !secretPattern.test(normalized),
    `${gate} evidence may contain a secret`,
  );
  return normalized;
};

export const validateReleaseEvidence = (source) => {
  assert(
    source && typeof source === 'object',
    'Release evidence must be an object',
  );
  assert(
    /^[0-9a-f]{40}$/.test(source.releaseCommit ?? ''),
    'releaseCommit must be a full lowercase Git SHA',
  );
  assert(
    ['staging', 'production'].includes(source.environment),
    'environment must be staging or production',
  );
  assert(
    source.gates && typeof source.gates === 'object',
    'gates are required',
  );
  assert(
    Object.keys(source.gates).length === requiredGateNames.length,
    'Evidence must contain exactly the required gates',
  );

  const gates = {};
  for (const name of requiredGateNames) {
    const gate = source.gates[name];
    assert(gate && typeof gate === 'object', `${name} gate is required`);
    assert(typeof gate.passed === 'boolean', `${name}.passed must be boolean`);
    gates[name] = {
      passed: gate.passed,
      evidence: safeEvidence(gate.evidence, name),
    };
  }
  assert(
    /^https:\/\/github\.com\/ddmikhailov\/event-kait20\/actions\/runs\/\d+$/.test(
      gates.ci.evidence,
    ),
    'ci evidence must be this repository GitHub Actions run URL',
  );
  return {
    releaseCommit: source.releaseCommit,
    environment: source.environment,
    gates,
  };
};

const check = (id, passed, detail) => ({ id, passed, detail });

export const evaluateReadiness = ({
  evidence,
  repository,
  deployment,
  artifacts,
  migrations,
  generatedAt,
}) => {
  const automatedChecks = [
    check('git-clean', repository.clean, repository.clean ? 'clean' : 'dirty'),
    check(
      'commit-match',
      repository.commit === evidence.releaseCommit,
      repository.commit,
    ),
    check('version-1.0.0', repository.version === '1.0.0', repository.version),
    ...artifacts.map((artifact) =>
      check(
        `artifact:${artifact.path}`,
        artifact.present,
        artifact.present ? 'present' : 'missing',
      ),
    ),
    check('production-config', deployment.valid, deployment.detail),
    check(
      'migrations-present',
      migrations.length > 0,
      `${migrations.length} migrations`,
    ),
  ];
  const externalGates = requiredGateNames.map((id) => ({
    id,
    ...evidence.gates[id],
  }));
  const ready =
    automatedChecks.every((item) => item.passed) &&
    externalGates.every((item) => item.passed);
  return {
    schemaVersion: 1,
    status: ready ? 'READY' : 'BLOCKED',
    generatedAt,
    environment: evidence.environment,
    releaseCommit: evidence.releaseCommit,
    automatedChecks,
    externalGates,
    deployment: deployment.summary,
    migrations,
  };
};

const runGit = (...arguments_) =>
  execFileSync('git', arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();

const sha256 = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const main = () => {
  const evidencePath = resolve(
    argument('--evidence', 'deploy/release-evidence.json'),
  );
  const envPath = resolve(argument('--env', 'deploy/native.env'));
  const outputPath = resolve(
    argument('--output', '.runtime/release-readiness.json'),
  );
  assert(existsSync(evidencePath), `Evidence file not found: ${evidencePath}`);

  const evidence = validateReleaseEvidence(
    JSON.parse(readFileSync(evidencePath, 'utf8')),
  );
  let deployment;
  try {
    assert(existsSync(envPath), `Environment file not found: ${envPath}`);
    const deploymentValues = parseEnvironment(readFileSync(envPath, 'utf8'));
    const summary = validateDeploymentConfig(deploymentValues, {
      checkFiles: true,
      envPath,
    });
    deployment = {
      valid: true,
      detail: 'validated without exposing secrets',
      summary: {
        webDomain: summary.webDomain,
        scannerDomain: summary.scannerDomain,
        apiDomain: summary.apiDomain,
      },
    };
  } catch (error) {
    deployment = {
      valid: false,
      detail: error instanceof Error ? error.message : 'configuration failed',
      summary: null,
    };
  }
  const packageJson = JSON.parse(
    readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
  );
  const artifactPaths = [
    'apps/web/dist/index.html',
    'apps/scanner/dist/index.html',
    'apps/scanner/dist/manifest.webmanifest',
  ];
  const artifacts = artifactPaths.map((path) => {
    const absolute = resolve(repositoryRoot, path);
    return {
      path,
      present: existsSync(absolute) && statSync(absolute).size > 0,
    };
  });
  const migrationDirectory = resolve(repositoryRoot, 'backend/migrations');
  const migrations = runGit('ls-files', 'backend/migrations/*.sql')
    .split(/\r?\n/)
    .filter(Boolean)
    .sort()
    .map((path) => ({
      name: basename(path),
      sha256: sha256(resolve(repositoryRoot, path)),
    }));
  const report = evaluateReadiness({
    evidence,
    repository: {
      clean: runGit('status', '--porcelain') === '',
      commit: runGit('rev-parse', 'HEAD'),
      version: packageJson.version,
    },
    deployment,
    artifacts,
    migrations,
    generatedAt: new Date().toISOString(),
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  if (process.platform !== 'win32') chmodSync(outputPath, 0o600);
  console.log(`Release readiness: ${report.status}`);
  console.log(`Report: ${outputPath}`);
  if (report.status !== 'READY') process.exitCode = 1;
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
