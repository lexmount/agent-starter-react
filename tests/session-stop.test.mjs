import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

async function loadSessionStopModule() {
  const source = await readFile(new URL('../lib/session-stop.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });

  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const { buildRoomInputStopPayload, resolveLiveKitHttpUrl, resolveRoomInputStopUrl } =
  await loadSessionStopModule();

test('derives room input stop URL from start URL', () => {
  assert.equal(
    resolveRoomInputStopUrl('http://localhost:8013/start'),
    'http://localhost:8013/stop'
  );
  assert.equal(resolveRoomInputStopUrl('http://localhost:8013'), 'http://localhost:8013/stop');
});

test('builds room input stop payload with current room name', () => {
  assert.deepEqual(buildRoomInputStopPayload('voice_assistant_room_1'), {
    room_name: 'voice_assistant_room_1',
  });
});

test('maps livekit websocket URLs to server API URLs', () => {
  assert.equal(resolveLiveKitHttpUrl('ws://localhost:7818'), 'http://localhost:7818');
  assert.equal(resolveLiveKitHttpUrl('wss://livekit.example'), 'https://livekit.example');
  assert.equal(resolveLiveKitHttpUrl('https://livekit.example'), 'https://livekit.example');
});

test('session stop route does not use generic camera endpoint fallback', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/stop/route.ts', import.meta.url),
    'utf8'
  );

  assert.match(routeSource, /process\.env\.ROOM_INPUT_URL/);
  assert.doesNotMatch(routeSource, /GENERIC_CAMERA_PARTICIPANT_URL/);
});

test('session stop route cancels room session before remote cleanup', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/stop/route.ts', import.meta.url),
    'utf8'
  );

  assert.match(routeSource, /markRoomSessionStopping/);
  assert.match(routeSource, /cancelPendingDispatches/);
  assert.match(routeSource, /markRoomSessionStopped/);
  assert.match(routeSource, /sessionId/);
  assert.match(routeSource, /dispatch_ids/);
});

test('session stop route deletes livekit room after room input stops', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/stop/route.ts', import.meta.url),
    'utf8'
  );

  assert.match(
    routeSource,
    /const cleanupResults = \[\s*await waitForPendingDispatches\(roomName, sessionId\),\s*await stopRoomInput\(roomName\),\s*await deleteLiveKitRoom\(roomName\),\s*\]/s
  );
});

test('session stop route defers remote cleanup for browser input source', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/stop/route.ts', import.meta.url),
    'utf8'
  );

  assert.match(routeSource, /function shouldDeferRemoteSessionCleanup/);
  assert.match(routeSource, /readStopInputSource\(\) === 'browser'/);
  assert.match(routeSource, /void runRemoteSessionCleanup/);
  assert.match(routeSource, /status: 'stopping'/);
  assert.match(routeSource, /\{ status: 202 \}/);
});
