import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WarmSandboxPool } from '../server/sandbox-gateway/warm-pool.mjs';

function createBroker() {
  const calls = [];
  return {
    calls,
    async createSandbox({ sessionId, ttlSeconds, warmupFullBody }) {
      calls.push({ type: 'create', sessionId, ttlSeconds, warmupFullBody });
      return {
        sandboxId: `sbx-${sessionId}`,
        proxyBaseUrl: `https://sandbox.local/api/v1/sandboxes/sbx-${sessionId}/proxy/4003/`,
      };
    },
    async releaseSandbox(sandboxId) {
      calls.push({ type: 'release', sandboxId });
    },
  };
}

test('warm pool creates ready sandboxes with extra idle ttl and checks them out', async () => {
  let now = 1_000;
  const broker = createBroker();
  const events = [];
  const pool = new WarmSandboxPool({
    broker,
    targetSize: 1,
    maxActiveSessions: 5,
    sandboxTtlSeconds: 3600,
    maxIdleSeconds: 300,
    now: () => now,
    randomId: () => 'pool-a',
    logger: (level, event, details) => events.push({ level, event, details }),
  });

  await pool.maintain({ activeCount: 0, trigger: 'test' });

  assert.deepEqual(broker.calls[0], {
    type: 'create',
    sessionId: 'lv_pool_pool-a',
    ttlSeconds: 3900,
    warmupFullBody: true,
  });
  assert.equal(pool.stats({ activeCount: 0 }).warmup_full_body, true);
  assert.equal(pool.stats({ activeCount: 0 }).ready, 1);

  now += 50;
  const sandbox = await pool.checkout();

  assert.equal(sandbox.sandboxId, 'sbx-lv_pool_pool-a');
  assert.equal(sandbox.allocationSource, 'warm_pool');
  assert.equal(pool.stats({ activeCount: 0 }).ready, 0);
  assert.equal(
    events.some((event) => event.event === 'warm_pool.checkout.hit'),
    true
  );
});

test('warm pool does not exceed remaining active-session capacity', async () => {
  const broker = createBroker();
  const pool = new WarmSandboxPool({
    broker,
    targetSize: 2,
    maxActiveSessions: 2,
    now: () => 1_000,
  });

  await pool.maintain({ activeCount: 2, trigger: 'test' });

  assert.equal(broker.calls.length, 0);
  assert.equal(pool.stats({ activeCount: 2 }).target_size, 0);
});

test('warm pool releases expired idle sandboxes instead of assigning them', async () => {
  let now = 1_000;
  const broker = createBroker();
  const pool = new WarmSandboxPool({
    broker,
    targetSize: 1,
    maxActiveSessions: 5,
    maxIdleSeconds: 1,
    now: () => now,
    randomId: () => 'pool-expired',
  });

  await pool.maintain({ activeCount: 0, trigger: 'test' });
  now += 1_001;

  const sandbox = await pool.checkout();

  assert.equal(sandbox, null);
  assert.deepEqual(broker.calls.at(-1), {
    type: 'release',
    sandboxId: 'sbx-lv_pool_pool-expired',
  });
});

test('warm pool refreshes before idle expiry and releases the older ready sandbox', async () => {
  let now = 1_000;
  const ids = ['old', 'new'];
  const broker = createBroker();
  const pool = new WarmSandboxPool({
    broker,
    targetSize: 1,
    maxActiveSessions: 5,
    maxIdleSeconds: 10,
    now: () => now,
    randomId: () => ids.shift(),
  });

  await pool.maintain({ activeCount: 0, trigger: 'initial' });
  now += 6_000;
  await pool.maintain({ activeCount: 0, trigger: 'refresh' });

  assert.deepEqual(
    broker.calls.filter((call) => call.type === 'create').map((call) => call.sessionId),
    ['lv_pool_old', 'lv_pool_new']
  );
  assert.deepEqual(broker.calls.at(-1), {
    type: 'release',
    sandboxId: 'sbx-lv_pool_old',
  });

  const sandbox = await pool.checkout();
  assert.equal(sandbox.sandboxId, 'sbx-lv_pool_new');
});
