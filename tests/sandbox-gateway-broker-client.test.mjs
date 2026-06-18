import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrokerClient } from '../server/sandbox-gateway/broker-client.mjs';

test('sandbox gateway sends SANDBOX_ENV values when creating a sandbox', async () => {
  const requests = [];
  const client = new BrokerClient({
    baseUrl: 'https://broker.example.test',
    token: 'broker-token',
    templateId: 'tpl-liveavatar',
    tenantId: 'lexmount',
    port: 4003,
    healthPort: 49999,
    readyTimeoutMs: 1,
    readyPollMs: 1,
    env: {
      INPUT_SOURCE: 'browser',
      AGENT_NAME: 'lexvoice-browser-agent',
      ROOM_INPUT_PORT: '8013',
    },
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (String(url).endsWith('/v1/sandboxes')) {
        return Response.json({
          id: 'sbx_broker_1',
          sandbox_id: 'sbx_broker_1',
          access_urls: {
            4003: 'https://sandbox.example.test/proxy/4003/',
          },
        });
      }
      return new Response('ok');
    },
  });

  const sandbox = await client.createSandbox({ sessionId: 'lv_abc', ttlSeconds: 3600 });

  assert.equal(sandbox.sandboxId, 'sbx_broker_1');
  const createRequest = requests.find((request) => String(request.url).endsWith('/v1/sandboxes'));
  const payload = JSON.parse(createRequest.init.body);
  assert.equal(payload.template_id, 'tpl-liveavatar');
  assert.equal(payload.lifetime_sec, 3600);
  assert.equal(payload.allow_internet_access, true);
  assert.deepEqual(payload.ports, [4003, 49999, 8013]);
  assert.deepEqual(payload.env_vars, {
    INPUT_SOURCE: 'browser',
    AGENT_NAME: 'lexvoice-browser-agent',
    ROOM_INPUT_PORT: '8013',
  });
  assert.equal(Object.hasOwn(payload, 'env'), false);
  assert.equal(Object.hasOwn(payload, 'ttl_sec'), false);
});

test('sandbox gateway sends template_id for the current sandbox broker API', async () => {
  const requests = [];
  const client = new BrokerClient({
    baseUrl: 'https://broker.example.test',
    token: 'broker-token',
    templateId: 'tpl-liveavatar',
    tenantId: 'lexmount',
    port: 4003,
    healthPort: 49999,
    readyTimeoutMs: 1,
    readyPollMs: 1,
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (String(url).endsWith('/v1/sandboxes')) {
        return Response.json({
          sandbox_id: 'sbx_template_1',
          access_urls: {
            4003: 'https://sandbox.example.test/proxy/4003/',
          },
        });
      }
      return new Response('ok');
    },
  });

  await client.createSandbox({ sessionId: 'lv_template', ttlSeconds: 3600 });

  const createRequest = requests.find((request) => String(request.url).endsWith('/v1/sandboxes'));
  const payload = JSON.parse(createRequest.init.body);
  assert.equal(payload.template_id, 'tpl-liveavatar');
  assert.deepEqual(payload.ports, [4003, 49999]);
  assert.equal(Object.hasOwn(payload, 'profile'), false);
});

test('sandbox gateway terminates sandboxes through the current broker API', async () => {
  const requests = [];
  const client = new BrokerClient({
    baseUrl: 'https://broker.example.test',
    token: 'broker-token',
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      return Response.json({ ok: true }, { status: 202 });
    },
  });

  await client.releaseSandbox('sbx/with space');

  assert.equal(
    requests[0].url,
    'https://broker.example.test/v1/sandboxes/sbx%2Fwith%20space/terminate'
  );
  assert.equal(requests[0].init.method, 'POST');
});

test('sandbox gateway requires SANDBOX_TEMPLATE_ID', async () => {
  const client = new BrokerClient({
    baseUrl: 'https://broker.example.test',
    token: 'broker-token',
    fetchImpl: async () => Response.json({}),
  });

  await assert.rejects(
    client.createSandbox({ sessionId: 'lv_missing_template', ttlSeconds: 3600 }),
    /SANDBOX_TEMPLATE_ID is required/
  );
});

test('sandbox gateway retries sandbox creation after a transient broker fetch failure', async () => {
  const requests = [];
  let createAttempts = 0;
  const client = new BrokerClient({
    baseUrl: 'https://broker.example.test',
    token: 'broker-token',
    templateId: 'tpl-liveavatar',
    tenantId: 'lexmount',
    port: 4003,
    healthPort: 49999,
    readyTimeoutMs: 1,
    readyPollMs: 1,
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (String(url).endsWith('/v1/sandboxes') && init.method === 'POST') {
        createAttempts += 1;
        if (createAttempts === 1) {
          throw new TypeError('fetch failed');
        }
        return Response.json({
          sandbox_id: 'sbx_retry_1',
          access_urls: {
            4003: 'https://sandbox.example.test/proxy/4003/',
          },
        });
      }
      if (String(url).endsWith('/v1/sandboxes') && init.method === 'GET') {
        return Response.json({ data: [] });
      }
      return new Response('ok');
    },
  });

  const sandbox = await client.createSandbox({ sessionId: 'lv_retry', ttlSeconds: 3600 });

  assert.equal(sandbox.sandboxId, 'sbx_retry_1');
  assert.equal(createAttempts, 2);
  assert.deepEqual(
    requests.map((request) => request.init.method || 'GET'),
    ['POST', 'GET', 'POST', 'GET']
  );
});
