import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { POST as endpointConnectivity } from '../app/api/endpoint/connectivity/route.ts';
import {
  ENDPOINT_CONNECTIVITY_TOKEN_HEADER,
  parseEndpointConnectivityPayload,
  readConnectivityToken,
  secretsMatch,
} from '../lib/endpoint-connectivity.ts';

async function temporaryRegistry() {
  const directory = path.join(tmpdir(), `generic-endpoint-route-${randomUUID()}`);
  await mkdir(directory, { mode: 0o700 });
  return directory;
}

test('endpoint connectivity payload accepts bounded endpoint identity metadata', () => {
  assert.deepEqual(
    parseEndpointConnectivityPayload({
      deviceId: 'yahboom-001',
      instanceId: '11111111-2222-4333-8444-555555555555',
      hostname: 'yahboom',
      address: '10.2.2.199',
    }),
    {
      ok: true,
      payload: {
        deviceId: 'yahboom-001',
        instanceId: '11111111-2222-4333-8444-555555555555',
        hostname: 'yahboom',
        address: '10.2.2.199',
      },
    }
  );
});

test('endpoint connectivity payload rejects unsafe device ids', () => {
  const result = parseEndpointConnectivityPayload({ deviceId: '../../yahboom' });
  assert.equal(result.ok, false);
});

test('endpoint connectivity payload rejects missing, extra, and non-v4 identity fields', () => {
  const valid = {
    deviceId: 'generic-orin',
    instanceId: '11111111-2222-4333-8444-555555555555',
    hostname: 'orin',
    address: '10.2.2.199',
  };
  for (const invalid of [
    { ...valid, extra: 'rejected' },
    { ...valid, hostname: undefined },
    { ...valid, instanceId: '11111111-2222-1333-8444-555555555555' },
  ]) {
    assert.equal(parseEndpointConnectivityPayload(invalid).ok, false);
  }
});

test('endpoint connectivity token supports a dedicated header and bearer auth', () => {
  assert.equal(
    readConnectivityToken(
      new Request('http://cloud.test/api/endpoint/connectivity', {
        headers: { [ENDPOINT_CONNECTIVITY_TOKEN_HEADER]: 'direct-token' },
      })
    ),
    'direct-token'
  );
  assert.equal(
    readConnectivityToken(
      new Request('http://cloud.test/api/endpoint/connectivity', {
        headers: { Authorization: 'Bearer bearer-token' },
      })
    ),
    'bearer-token'
  );
});

test('endpoint connectivity token comparison requires an exact match', () => {
  assert.equal(secretsMatch('probe-secret', 'probe-secret'), true);
  assert.equal(secretsMatch('probe-secret', 'other-secret'), false);
});

test('connectivity route renews only the configured fixed device lease', async () => {
  const names = [
    'ENDPOINT_CONNECTIVITY_TOKEN',
    'GENERIC_EDGE_MEDIA_DEVICE_ID',
    'GENERIC_EDGE_MEDIA_ALLOWED_CIDRS',
    'GENERIC_ENDPOINT_REGISTRY_DIR',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    ENDPOINT_CONNECTIVITY_TOKEN: 'probe-secret',
    GENERIC_EDGE_MEDIA_DEVICE_ID: 'generic-orin',
    GENERIC_EDGE_MEDIA_ALLOWED_CIDRS: '10.2.0.0/16',
    GENERIC_ENDPOINT_REGISTRY_DIR: await temporaryRegistry(),
  });
  try {
    const response = await endpointConnectivity(
      new Request('http://cloud.test/api/endpoint/connectivity', {
        method: 'POST',
        headers: {
          [ENDPOINT_CONNECTIVITY_TOKEN_HEADER]: 'probe-secret',
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.55',
        },
        body: JSON.stringify({
          deviceId: 'generic-orin',
          instanceId: '11111111-2222-4333-8444-555555555555',
          hostname: 'orin',
          address: '10.2.2.199',
        }),
      })
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, 'leased');
    assert.equal(payload.deviceId, 'generic-orin');
    assert.equal(payload.instanceId, '11111111-2222-4333-8444-555555555555');
    assert.equal(payload.hostname, 'orin');
    assert.equal(payload.address, '10.2.2.199');
    assert.equal('token' in payload, false);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous[name];
      }
    }
  }
});
