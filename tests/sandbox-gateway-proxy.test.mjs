import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildProxyTarget,
  rewriteSandboxAppConfig,
  sandboxAppConfigOverrides,
  shouldDropProxyResponseHeader,
} from '../server/sandbox-gateway/server.mjs';

test('sandbox gateway strips the session slug when proxying session-prefixed paths', () => {
  const target = buildProxyTarget({
    pathname: '/abc123/api/client-config',
    search: '?token=gateway-token&debug=1',
    slug: 'abc123',
    proxyBaseUrl: 'https://sandbox.local/api/v1/sandboxes/sbx/proxy/4003/',
  });

  assert.equal(
    target,
    'https://sandbox.local/api/v1/sandboxes/sbx/proxy/4003/api/client-config?debug=1'
  );
});

test('sandbox gateway preserves absolute app paths', () => {
  const target = buildProxyTarget({
    pathname: '/_next/static/chunk.js',
    search: '?token=gateway-token',
    slug: 'abc123',
    proxyBaseUrl: 'https://sandbox.local/api/v1/sandboxes/sbx/proxy/4003/',
  });

  assert.equal(
    target,
    'https://sandbox.local/api/v1/sandboxes/sbx/proxy/4003/_next/static/chunk.js'
  );
});

test('sandbox gateway drops response headers that are invalid after fetch body decoding', () => {
  assert.equal(shouldDropProxyResponseHeader('connection'), true);
  assert.equal(shouldDropProxyResponseHeader('content-encoding'), false);
  assert.equal(shouldDropProxyResponseHeader('content-encoding', { fetchedBody: true }), true);
  assert.equal(shouldDropProxyResponseHeader('content-length', { fetchedBody: true }), true);
  assert.equal(shouldDropProxyResponseHeader('etag', { fetchedBody: true }), true);
  assert.equal(shouldDropProxyResponseHeader('content-type', { fetchedBody: true }), false);
});

test('sandbox app config enables browser raw media while keeping browser microphone controls', () => {
  assert.deepEqual(sandboxAppConfigOverrides(), {
    inputSource: {
      type: 'string',
      value: 'browser',
    },
    audioInputDevice: {
      type: 'string',
      value: 'browser',
    },
    visionInputDevice: {
      type: 'string',
      value: 'browser',
    },
    outputDevice: {
      type: 'string',
      value: 'browser',
    },
    usesBrowserRawMediaInput: {
      type: 'boolean',
      value: true,
    },
    usesBrowserRawAudioInput: {
      type: 'boolean',
      value: true,
    },
    usesBrowserRawVideoInput: {
      type: 'boolean',
      value: true,
    },
    usesServerRoomInput: {
      type: 'boolean',
      value: false,
    },
    supportsScreenShare: {
      type: 'boolean',
      value: false,
    },
    showDefaultCameraPreview: {
      type: 'boolean',
      value: false,
    },
  });
});

test('sandbox app config only overrides agent name when explicitly configured', () => {
  assert.deepEqual(sandboxAppConfigOverrides({ agentName: 'frontdesk-agent' }).agentName, {
    type: 'string',
    value: 'frontdesk-agent',
  });
});

test('sandbox gateway preserves proxied app agent name by default', () => {
  const body =
    '<script>self.__next_f.push([1,"{\\"usesServerRoomInput\\":false,\\"sandboxId\\":\\"$undefined\\",\\"agentName\\":\\"frontdesk-agent\\"}"])</script>';

  assert.equal(
    rewriteSandboxAppConfig(body, { sandboxId: 'sbx_123' }),
    '<script>self.__next_f.push([1,"{\\"usesServerRoomInput\\":false,\\"sandboxId\\":\\"sbx_123\\",\\"agentName\\":\\"frontdesk-agent\\"}"])</script>'
  );
});

test('sandbox gateway can explicitly override proxied app agent name', () => {
  const body =
    '<script>self.__next_f.push([1,"{\\"usesServerRoomInput\\":false,\\"sandboxId\\":\\"$undefined\\",\\"agentName\\":\\"frontdesk-agent\\"}"])</script>';

  assert.equal(
    rewriteSandboxAppConfig(
      body,
      { sandboxId: 'sbx_123' },
      { agentName: 'lexvoice-browser-agent' }
    ),
    '<script>self.__next_f.push([1,"{\\"usesServerRoomInput\\":false,\\"sandboxId\\":\\"sbx_123\\",\\"agentName\\":\\"lexvoice-browser-agent\\"}"])</script>'
  );
});

test('sandbox gateway preserves unescaped agent name by default', () => {
  const body = '<script>{"sandboxId":null,"agentName":"frontdesk-agent"}</script>';

  assert.equal(
    rewriteSandboxAppConfig(body, { sandboxId: 'sbx_123' }),
    '<script>{"sandboxId":"sbx_123","agentName":"frontdesk-agent"}</script>'
  );
});

test('sandbox gateway can explicitly override unescaped agent name', () => {
  const body = '<script>{"sandboxId":null,"agentName":"frontdesk-agent"}</script>';

  assert.equal(
    rewriteSandboxAppConfig(
      body,
      { sandboxId: 'sbx_123' },
      { agentName: 'lexvoice-browser-agent' }
    ),
    '<script>{"sandboxId":"sbx_123","agentName":"lexvoice-browser-agent"}</script>'
  );
});

test('sandbox app config can explicitly override agent name', () => {
  assert.deepEqual(sandboxAppConfigOverrides({ agentName: 'lexvoice-browser-agent' }).agentName, {
    type: 'string',
    value: 'lexvoice-browser-agent',
  });
});

test('sandbox gateway rewrites proxied app config for broker sandboxes', () => {
  const body =
    '<script>self.__next_f.push([1,"{\\"usesServerRoomInput\\":false,\\"sandboxId\\":\\"$undefined\\",\\"agentName\\":\\"lexvoice-xunfei-agent\\"}"])</script>';

  assert.equal(
    rewriteSandboxAppConfig(
      body,
      { sandboxId: 'sbx_123' },
      { agentName: 'lexvoice-browser-agent' }
    ),
    '<script>self.__next_f.push([1,"{\\"usesServerRoomInput\\":false,\\"sandboxId\\":\\"sbx_123\\",\\"agentName\\":\\"lexvoice-browser-agent\\"}"])</script>'
  );
});

test('sandbox gateway rewrites unescaped agent name from proxied app config', () => {
  const body = '<script>{"sandboxId":null,"agentName":"lexvoice-xunfei-agent"}</script>';

  assert.equal(
    rewriteSandboxAppConfig(
      body,
      { sandboxId: 'sbx_123' },
      { agentName: 'lexvoice-browser-agent' }
    ),
    '<script>{"sandboxId":"sbx_123","agentName":"lexvoice-browser-agent"}</script>'
  );
});
