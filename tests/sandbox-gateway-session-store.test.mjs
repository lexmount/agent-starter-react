import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SessionStore } from '../server/sandbox-gateway/session-store.mjs';

function createBroker() {
  const calls = [];
  return {
    calls,
    async createSandbox({ sessionId, ttlSeconds }) {
      calls.push({ type: 'create', sessionId, ttlSeconds });
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

function createStore(options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lv-sandbox-gateway-'));
  const broker = createBroker();
  const ids = ['abc123', 'def456', 'ghi789'];
  const tokens = ['token-a', 'token-b', 'token-c'];
  const store = new SessionStore({
    broker,
    stateFile: path.join(dir, 'sessions.json'),
    randomId: () => ids.shift(),
    randomToken: () => tokens.shift(),
    now: () => 1_000,
    ...options,
  });
  return {
    broker,
    store,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('sandbox gateway does not reuse sessions by IP', async () => {
  const { broker, store, cleanup } = createStore();
  try {
    const first = await store.acquire({ ip: '10.0.0.1' });
    const second = await store.acquire({ ip: '10.0.0.1' });

    assert.equal(first.slug, 'abc123');
    assert.equal(second.slug, 'def456');
    assert.equal(broker.calls.filter((call) => call.type === 'create').length, 2);
  } finally {
    cleanup();
  }
});

test('sandbox gateway validates token across IP changes', async () => {
  const { store, cleanup } = createStore();
  try {
    const session = await store.acquire({ ip: '10.0.0.1' });
    const loaded = store.requireSession({
      slug: session.slug,
      token: session.token,
      ip: '10.0.0.2',
    });

    assert.equal(loaded.slug, session.slug);
  } finally {
    cleanup();
  }
});

test('sandbox gateway keeps active sessions releasable when broker release fails', async () => {
  const { broker, store, cleanup } = createStore();
  broker.releaseSandbox = async (sandboxId) => {
    broker.calls.push({ type: 'release', sandboxId });
    throw new Error('release failed');
  };

  try {
    const session = await store.acquire({ ip: '10.0.0.1' });

    await assert.rejects(
      store.release({
        slug: session.slug,
        token: session.token,
        ip: '10.0.0.1',
      }),
      /release failed/
    );

    assert.equal(store.sessions[0].status, 'active');
    assert.equal(store.sessions[0].releasedAt, null);
    assert.equal(store.activeSessions().length, 1);
    assert.deepEqual(broker.calls.at(-1), {
      type: 'release',
      sandboxId: 'sbx-lv_abc123',
    });
  } finally {
    cleanup();
  }
});

test('sandbox gateway checks out a warm sandbox before cold creation', async () => {
  const { broker, store, cleanup } = createStore({
    warmPool: {
      async checkout() {
        return {
          sandboxId: 'warm-sbx-1',
          proxyBaseUrl: 'https://sandbox.local/api/v1/sandboxes/warm-sbx-1/proxy/4003/',
          allocationSource: 'warm_pool',
        };
      },
      stats() {
        return {
          enabled: true,
          target_size: 1,
          configured_size: 1,
          ready: 0,
          warming: 0,
        };
      },
    },
  });

  try {
    const session = await store.acquire({ ip: '10.0.0.1' });

    assert.equal(session.sandboxId, 'warm-sbx-1');
    assert.equal(session.allocationSource, 'warm_pool');
    assert.equal(broker.calls.filter((call) => call.type === 'create').length, 0);
  } finally {
    cleanup();
  }
});
