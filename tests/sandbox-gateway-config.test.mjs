import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSandboxGatewayConfig } from '../server/sandbox-gateway/config.mjs';

test('sandbox gateway config reads the current sandbox template id', () => {
  const config = readSandboxGatewayConfig({
    SANDBOX_TEMPLATE_ID: 'tpl-liveavatar',
    SANDBOX_EXTRA_PORTS: '8013, 18084, bad',
    LIVEAVATAR_WARM_POOL_SIZE: '2',
    LIVEAVATAR_WARM_POOL_REFILL_INTERVAL_SECONDS: '7',
    LIVEAVATAR_WARM_POOL_MAX_IDLE_SECONDS: '120',
    LIVEAVATAR_WARM_POOL_WARMUP_FULL_BODY: '0',
  });

  assert.equal(config.sandboxTemplateId, 'tpl-liveavatar');
  assert.deepEqual(config.sandboxExtraPorts, [8013, 18084]);
  assert.equal(config.warmPoolSize, 2);
  assert.equal(config.warmPoolRefillIntervalMs, 7000);
  assert.equal(config.warmPoolMaxIdleSeconds, 120);
  assert.equal(config.warmPoolWarmupFullBody, false);
});
