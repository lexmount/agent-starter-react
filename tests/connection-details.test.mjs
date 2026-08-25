import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

process.env.LIVEKIT_URL = 'ws://localhost:7818';
process.env.LIVEKIT_API_KEY = 'devkey';
process.env.LIVEKIT_API_SECRET = 'devsecret-devsecret-devsecret-dev';

const { resolveConnectionRoomId } = await import('../lib/connection-room-id.ts');
const { readConnectionDetailsResponse } = await import('../lib/connection-details-response.ts');

test('connection details reuse a client supplied room id', async () => {
  const roomId = '11111111-2222-4333-8444-555555555555';
  assert.equal(resolveConnectionRoomId({ room_id: roomId }), roomId);
});

test('connection details prefer a client supplied session id', async () => {
  const sessionId = '11111111-2222-4333-8444-555555555555';
  assert.equal(resolveConnectionRoomId({ sessionId }), sessionId);
  assert.equal(resolveConnectionRoomId({ session_id: sessionId }), sessionId);
});

test('connection details ignore an invalid client supplied room id', async () => {
  assert.equal(
    resolveConnectionRoomId({ room_id: '../../not-a-room' }, () => {
      return '22222222-3333-4444-8555-666666666666';
    }),
    '22222222-3333-4444-8555-666666666666'
  );
});

test('connection details parse a valid response body', async () => {
  const payload = {
    serverUrl: 'wss://example.livekit.cloud',
    sessionId: '11111111-2222-4333-8444-555555555555',
    roomName: 'voice_assistant_room_11111111-2222-4333-8444-555555555555',
    participantName: 'user',
    participantToken: 'token',
  };

  const result = await readConnectionDetailsResponse(
    new Response(JSON.stringify(payload), { status: 200 })
  );

  assert.deepEqual(result, payload);
});

test('connection details fill legacy responses with the requested session id', async () => {
  const sessionId = '11111111-2222-4333-8444-555555555555';
  const payload = {
    serverUrl: 'wss://example.livekit.cloud',
    roomName: 'voice_assistant_room_11111111-2222-4333-8444-555555555555',
    participantName: 'user',
    participantToken: 'token',
  };

  const result = await readConnectionDetailsResponse(
    new Response(JSON.stringify(payload), { status: 200 }),
    { sessionId }
  );

  assert.deepEqual(result, { ...payload, sessionId });
});

test('connection details surface non-OK response text', async () => {
  await assert.rejects(
    readConnectionDetailsResponse(new Response('LIVEKIT_API_KEY is not defined', { status: 500 })),
    /LIVEKIT_API_KEY is not defined/
  );
});

test('connection details reject malformed success payloads', async () => {
  await assert.rejects(
    readConnectionDetailsResponse(
      new Response(JSON.stringify({ serverUrl: 'wss://example.test' }))
    ),
    /missing required fields/
  );
});

test('connection details route logs issued token with canonical session identity', async () => {
  const routeSource = await readFile(
    new URL('../app/api/connection-details/route.ts', import.meta.url),
    'utf8'
  );

  assert.match(routeSource, /console\.info\('agent session connection details issued'/);
  assert.match(routeSource, /sessionId/);
  assert.match(routeSource, /roomName/);
  assert.match(routeSource, /participantIdentity/);
});

test('connection details advertise the explicit browser LiveKit URL without Host derivation', async () => {
  process.env.LIVEKIT_BROWSER_URL = 'ws://10.2.77.108:7818';
  process.env.LIVEKIT_URL = 'ws://127.0.0.1:7818';
  const { POST } = await import(
    new URL('../app/api/connection-details/route.ts?browser-url-contract', import.meta.url).href
  );

  const response = await POST(
    new Request('http://attacker.example/api/connection-details', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'attacker.example',
        'x-forwarded-host': 'forwarded-attacker.example',
      },
      body: '{}',
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.serverUrl, 'ws://10.2.77.108:7818');
  const routeSource = await readFile(
    new URL('../app/api/connection-details/route.ts', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(routeSource, /headers\.get\(['"](?:host|x-forwarded-host)['"]\)/i);
});

test('connection details fall back to internal LiveKit URL for standalone localhost', async () => {
  delete process.env.LIVEKIT_BROWSER_URL;
  process.env.LIVEKIT_URL = 'ws://localhost:7818';
  const { POST } = await import(
    new URL('../app/api/connection-details/route.ts?localhost-fallback', import.meta.url).href
  );

  const response = await POST(
    new Request('http://localhost/api/connection-details', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.serverUrl, 'ws://localhost:7818');
});
