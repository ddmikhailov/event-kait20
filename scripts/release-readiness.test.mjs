import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ReleaseReadinessError,
  evaluateReadiness,
  validateReleaseEvidence,
} from './release-readiness.mjs';

const releaseCommit = 'a'.repeat(40);
const gateNames = [
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
const validEvidence = () => ({
  releaseCommit,
  environment: 'production',
  gates: Object.fromEntries(
    gateNames.map((name) => [
      name,
      {
        passed: true,
        evidence:
          name === 'ci'
            ? 'https://github.com/ddmikhailov/event-kait20/actions/runs/12345'
            : `KAIT-${name}-1234`,
      },
    ]),
  ),
});

test('accepts complete non-secret release evidence', () => {
  const evidence = validateReleaseEvidence(validEvidence());
  assert.equal(evidence.environment, 'production');
  assert.equal(evidence.gates.backupRestore.passed, true);
});

test('rejects placeholders, secrets and foreign CI URLs', () => {
  for (const mutate of [
    (value) => (value.gates.backupRestore.evidence = 'pending'),
    (value) => (value.gates.smtpDelivery.evidence = 'password=leaked'),
    (value) =>
      (value.gates.ci.evidence =
        'https://github.com/another/project/actions/runs/12345'),
  ]) {
    const evidence = validEvidence();
    mutate(evidence);
    assert.throws(
      () => validateReleaseEvidence(evidence),
      ReleaseReadinessError,
    );
  }
});

test('reports READY only when automated and external gates pass', () => {
  const evidence = validateReleaseEvidence(validEvidence());
  const input = {
    evidence,
    repository: { clean: true, commit: releaseCommit, version: '1.0.0' },
    deployment: {
      valid: true,
      detail: 'valid',
      summary: {
        webDomain: 'events.kait20.ru',
        scannerDomain: 'scanner.kait20.ru',
        apiDomain: 'api.kait20.ru',
      },
    },
    artifacts: [{ path: 'apps/web/dist/index.html', present: true }],
    migrations: [{ name: '001.sql', sha256: 'b'.repeat(64) }],
    generatedAt: '2026-08-26T00:00:00.000Z',
  };
  assert.equal(evaluateReadiness(input).status, 'READY');
  input.repository.clean = false;
  assert.equal(evaluateReadiness(input).status, 'BLOCKED');
  input.repository.clean = true;
  input.evidence.gates.deviceE2e.passed = false;
  assert.equal(evaluateReadiness(input).status, 'BLOCKED');
  input.evidence.gates.deviceE2e.passed = true;
  input.deployment.valid = false;
  input.deployment.detail = 'configuration failed';
  assert.equal(evaluateReadiness(input).status, 'BLOCKED');
});

test('report contains references but never deployment secrets', () => {
  const evidence = validateReleaseEvidence(validEvidence());
  const report = evaluateReadiness({
    evidence,
    repository: { clean: true, commit: releaseCommit, version: '1.0.0' },
    deployment: {
      valid: true,
      detail: 'validated without exposing secrets',
      summary: {
        webDomain: 'events.kait20.ru',
        scannerDomain: 'scanner.kait20.ru',
        apiDomain: 'api.kait20.ru',
      },
    },
    artifacts: [],
    migrations: [{ name: '001.sql', sha256: 'b'.repeat(64) }],
    generatedAt: '2026-08-26T00:00:00.000Z',
  });
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /DATABASE_URL|SESSION_SECRET|SMTP_PASSWORD/);
  assert.match(serialized, /KAIT-backupRestore-1234/);
});
