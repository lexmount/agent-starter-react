import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { createServer } from '../server/sandbox-gateway/server.mjs';
import {
  SignatureAuthenticator,
  buildCanonicalSignaturePayload,
  stableJsonStringify,
} from '../server/sandbox-gateway/signature-auth.mjs';

function createSigningClient({ clientId = 'client_001', nowSeconds = 1_781_496_000 } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
  const publicKeyBase64 = Buffer.from(publicKeyDer).subarray(-32).toString('base64');

  return {
    clientId,
    nowSeconds,
    publicKeyBase64,
    sign({ method = 'POST', path = '/__gateway/sessions', body = {}, nonce = 'nonce-1' } = {}) {
      const canonical = buildCanonicalSignaturePayload({
        clientId,
        timestamp: nowSeconds,
        nonce,
        method,
        path,
        body,
      });
      return {
        'x-client-id': clientId,
        'x-timestamp': String(nowSeconds),
        'x-nonce': nonce,
        'x-signature': crypto.sign(null, canonical, privateKey).toString('base64'),
      };
    },
  };
}

test('sandbox gateway canonical JSON matches the Python signing shape', () => {
  assert.equal(stableJsonStringify({ b: 2, a: '中' }), '{"a":"\\u4e2d","b":2}');
});

test('sandbox gateway verifies Ed25519 signed requests and rejects nonce replay', () => {
  const client = createSigningClient();
  const auth = new SignatureAuthenticator({
    clients: `${client.clientId}:${client.publicKeyBase64}`,
    now: () => client.nowSeconds * 1000,
  });
  const body = { invite: 'internal' };
  const headers = client.sign({ body });

  const verified = auth.verify({
    headers,
    method: 'POST',
    path: '/__gateway/sessions',
    body,
  });
  assert.deepEqual(verified, { clientId: client.clientId });

  assert.throws(
    () =>
      auth.verify({
        headers,
        method: 'POST',
        path: '/__gateway/sessions',
        body,
      }),
    /replay nonce/
  );
});

test('sandbox gateway rejects invalid signatures', () => {
  const client = createSigningClient();
  const auth = new SignatureAuthenticator({
    clients: `${client.clientId}:${client.publicKeyBase64}`,
    now: () => client.nowSeconds * 1000,
  });
  const body = { invite: 'internal' };
  const headers = client.sign({ body });

  assert.throws(
    () =>
      auth.verify({
        headers,
        method: 'POST',
        path: '/__gateway/sessions',
        body: { invite: 'tampered' },
      }),
    /invalid signature/
  );
});

test('sandbox gateway signed session endpoint creates a sandbox session', async () => {
  const client = createSigningClient();
  const auth = new SignatureAuthenticator({
    clients: `${client.clientId}:${client.publicKeyBase64}`,
    now: () => client.nowSeconds * 1000,
  });
  const store = {
    activeSessions: () => [],
    async acquire() {
      return {
        slug: 'abc123',
        token: 'token-a',
        sandboxId: 'sbx-abc123',
        expiresAt: (client.nowSeconds + 3600) * 1000,
      };
    },
  };
  const server = createServer({
    config: {
      gatewayAuth: 'signature',
      maxActiveSessions: 5,
    },
    store,
    signatureAuth: auth,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const body = { invite: 'internal' };
    const response = await fetch(`${baseUrl}/__gateway/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...client.sign({ body }),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'created');
    assert.equal(payload.url, '/abc123?token=token-a');
    assert.equal(payload.slug, 'abc123');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
