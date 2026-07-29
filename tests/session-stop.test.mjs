import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as agentWorkerReadiness from '../lib/agent-worker-readiness.ts';
import { resolveLiveKitHttpUrl, resolveRoomInputStopUrls } from '../lib/session-stop.ts';

const { readAgentWorkerStateFromLog } = agentWorkerReadiness;

function replaceEnv(replacements) {
  const previous = new Map();
  for (const [name, value] of Object.entries(replacements)) {
    previous.set(name, process.env[name]);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
}

test('parses the latest worker state from the dedicated agent process log', () => {
  const source = [
    '2026-07-29 18:01:19,090 - INFO livekit.agents - registered worker',
    '2026-07-29 18:01:34,093 - INFO livekit.agents - worker is at full capacity, marking as unavailable',
    '2026-07-29 18:01:51,597 - INFO livekit.agents - worker is below capacity, marking as available',
  ].join('\n');

  assert.equal(readAgentWorkerStateFromLog(source), 'available');
  assert.equal(readAgentWorkerStateFromLog('unrelated output'), 'unknown');
});

test('worker registration does not override an existing full-capacity state', () => {
  const fullThenRegistered = [
    '2026-07-29 18:01:34,093 - INFO livekit.agents - worker is at full capacity, marking as unavailable',
    '2026-07-29 18:01:35,093 - INFO livekit.agents - registered worker',
  ].join('\n');
  const recoveredAfterReconnect = [
    fullThenRegistered,
    '2026-07-29 18:01:51,597 - INFO livekit.agents - worker is below capacity, marking as available',
  ].join('\n');

  assert.equal(readAgentWorkerStateFromLog(fullThenRegistered), 'unavailable');
  assert.equal(readAgentWorkerStateFromLog(recoveredAfterReconnect), 'available');
});

test('waits through unknown worker states until the worker becomes available', async () => {
  assert.equal(typeof agentWorkerReadiness.waitForAgentWorkerAvailable, 'function');

  const states = ['unknown', 'unavailable', 'available'];
  let now = 0;
  const ready = await agentWorkerReadiness.waitForAgentWorkerAvailable(
    async () => states.shift() ?? 'available',
    {
      timeoutMs: 10,
      pollMs: 1,
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    }
  );

  assert.equal(ready, true);
  assert.equal(states.length, 0);
});

test('maps livekit websocket URLs to server API URLs', () => {
  assert.equal(resolveLiveKitHttpUrl('ws://localhost:7818'), 'http://localhost:7818');
  assert.equal(resolveLiveKitHttpUrl('wss://livekit.example'), 'https://livekit.example');
  assert.equal(resolveLiveKitHttpUrl('https://livekit.example'), 'https://livekit.example');
});

test('room input stop URL resolver ignores primebot non-server input', () => {
  assert.deepEqual(
    resolveRoomInputStopUrls({
      inputSource: 'primebot',
      roomInputUrl: 'http://room-input.local/start',
      roomAudioInputUrl: 'http://audio.local/start',
      roomVisionInputUrl: 'http://vision.local/start',
      frontdeskInputParticipantUrl: 'http://xunfei.local/start',
      faceServiceUrl: 'http://face.local/start',
      genericCameraParticipantUrl: 'http://generic.local/start',
    }),
    []
  );
});

test('room input stop URL resolver only stops selected mixed server roles', () => {
  assert.deepEqual(
    resolveRoomInputStopUrls({
      inputSource: 'mixed',
      audioInputDevice: 'xunfei',
      visionInputDevice: 'browser',
      roomAudioInputUrl: 'http://xunfei-audio.local/start',
      roomVisionInputUrl: 'http://unused-vision.local/start',
      roomInputUrl: 'http://fallback.local/start',
      frontdeskInputParticipantUrl: 'http://frontdesk.local/start',
      faceServiceUrl: 'http://face.local/start',
      genericCameraParticipantUrl: 'http://generic.local/start',
    }),
    ['http://xunfei-audio.local/stop', 'http://frontdesk.local/stop', 'http://face.local/stop']
  );
});

test('session stop route can call the room-input control endpoint before deleting the room', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/stop/route.ts', import.meta.url),
    'utf8'
  );

  const cleanupSource = routeSource.match(/async function runRemoteSessionCleanup[\s\S]*?\n}/)?.[0];

  assert.ok(cleanupSource, 'runRemoteSessionCleanup should be defined');
  assert.match(routeSource, /readStopEnv\('ROOM_INPUT_URL'\)/);
  assert.match(routeSource, /resolveRoomInputStopUrls/);
  assert.match(routeSource, /stopRoomInput/);
  assert.match(routeSource, /FRONTDESK_INPUT_PARTICIPANT_URL/);
  assert.match(routeSource, /FACE_SERVICE_URL/);
  assert.match(routeSource, /GENERIC_CAMERA_PARTICIPANT_URL/);
  assert.match(
    cleanupSource,
    /const roomInputResults = await stopRoomInput\(roomName, sessionId\);[\s\S]*const liveKitRoomResult = await deleteLiveKitRoom\(roomName\);/
  );
});

test('session stop route gives room-input its full backend stop window', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/stop/route.ts', import.meta.url),
    'utf8'
  );

  assert.match(routeSource, /readPositiveIntEnv\('ROOM_INPUT_STOP_TIMEOUT_MS', 7_000\)/);
});

test('session stop route treats non-2xx and aborted room-input stops as blocking failures', async () => {
  const originalFetch = globalThis.fetch;
  const runLogDir = await mkdtemp(path.join(tmpdir(), 'lexvoice-ui-stop-'));
  await writeFile(
    path.join(runLogDir, 'live.log'),
    '2026-07-29 18:01:19,090 - INFO livekit.agents - registered worker\n'
  );
  const restoreEnv = replaceEnv({
    INPUT_SOURCE: 'xunfei',
    ROOM_INPUT_URL: 'http://room-input.local/start',
    ROOM_AUDIO_INPUT_URL: undefined,
    ROOM_VISION_INPUT_URL: undefined,
    FRONTDESK_INPUT_PARTICIPANT_URL: undefined,
    FACE_SERVICE_URL: undefined,
    GENERIC_CAMERA_PARTICIPANT_URL: undefined,
    LIVEKIT_URL: undefined,
    LIVEKIT_API_KEY: undefined,
    LIVEKIT_API_SECRET: undefined,
    LEXVOICE_RUN_LOG_DIR: runLogDir,
    ROOM_INPUT_STOP_TIMEOUT_MS: '20',
  });
  let fetchCount = 0;
  let observedAbort = false;
  globalThis.fetch = async (_url, init = {}) => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return { ok: false, status: 503 };
    }
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener(
        'abort',
        () => {
          observedAbort = true;
          reject(new Error('room-input request aborted'));
        },
        { once: true }
      );
    });
  };

  try {
    const routeUrl = new URL('../app/api/session/stop/route.ts', import.meta.url);
    routeUrl.searchParams.set('test', randomUUID());
    const routeModule = await import(routeUrl.href);
    const post = routeModule.POST ?? routeModule.default?.POST;
    assert.equal(typeof post, 'function');

    const nonOkResponse = await post(
      new Request('http://localhost/api/session/stop', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: '11111111-2222-4333-8444-555555555555',
        }),
      })
    );
    const nonOkBody = await nonOkResponse.json();
    const abortedResponse = await post(
      new Request('http://localhost/api/session/stop', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: '11111111-2222-4333-8444-555555555555',
        }),
      })
    );
    const abortedBody = await abortedResponse.json();

    assert.equal(nonOkResponse.status, 502);
    assert.equal(nonOkBody.status, 'partial');
    assert.equal(observedAbort, true);
    assert.equal(abortedResponse.status, 502);
    assert.equal(abortedBody.status, 'partial');
    assert.equal(
      abortedBody.results.some((result) => result.target === 'room_input' && result.ok === false),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
    await rm(runLogDir, { recursive: true, force: true });
  }
});

test('session stop retry accepts only LiveKit room not-found as already stopped', async () => {
  const originalFetch = globalThis.fetch;
  const runLogDir = await mkdtemp(path.join(tmpdir(), 'lexvoice-ui-stop-retry-'));
  await writeFile(
    path.join(runLogDir, 'live.log'),
    '2026-07-29 18:01:19,090 - INFO livekit.agents - registered worker\n'
  );
  const restoreEnv = replaceEnv({
    INPUT_SOURCE: 'xunfei',
    ROOM_INPUT_URL: 'http://room-input.local/start',
    ROOM_AUDIO_INPUT_URL: undefined,
    ROOM_VISION_INPUT_URL: undefined,
    FRONTDESK_INPUT_PARTICIPANT_URL: undefined,
    FACE_SERVICE_URL: undefined,
    GENERIC_CAMERA_PARTICIPANT_URL: undefined,
    LIVEKIT_URL: 'ws://livekit.local',
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'secretsecretsecretsecretsecretsecret',
    LEXVOICE_RUN_LOG_DIR: runLogDir,
  });
  let roomInputStopCount = 0;
  let liveKitDeleteCount = 0;
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.startsWith('http://room-input.local/')) {
      roomInputStopCount += 1;
      return new Response('{}', {
        status: roomInputStopCount === 1 ? 503 : 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (requestUrl.includes('/twirp/livekit.RoomService/DeleteRoom')) {
      liveKitDeleteCount += 1;
      if (liveKitDeleteCount === 1) {
        return Response.json({});
      }
      if (liveKitDeleteCount === 2) {
        return Response.json(
          { code: 'not_found', msg: 'room not found' },
          { status: 404, statusText: 'Not Found' }
        );
      }
      return Response.json(
        { code: 'internal', msg: 'storage unavailable' },
        { status: 500, statusText: 'Internal Server Error' }
      );
    }
    throw new Error(`unexpected fetch: ${requestUrl}`);
  };

  try {
    const routeUrl = new URL('../app/api/session/stop/route.ts', import.meta.url);
    routeUrl.searchParams.set('test', randomUUID());
    const routeModule = await import(routeUrl.href);
    const post = routeModule.POST ?? routeModule.default?.POST;
    assert.equal(typeof post, 'function');
    const makeRequest = () =>
      new Request('http://localhost/api/session/stop', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: '11111111-2222-4333-8444-555555555555',
        }),
      });

    const firstResponse = await post(makeRequest());
    const retryResponse = await post(makeRequest());
    const unrelatedDeleteFailureResponse = await post(makeRequest());

    assert.equal(firstResponse.status, 502);
    assert.equal(retryResponse.status, 200);
    assert.equal(unrelatedDeleteFailureResponse.status, 502);
    assert.equal(roomInputStopCount, 3);
    assert.equal(liveKitDeleteCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
    await rm(runLogDir, { recursive: true, force: true });
  }
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
  assert.match(routeSource, /deriveLiveKitRoomName/);
  assert.match(routeSource, /deriveSessionIdFromLiveKitRoomName/);
  assert.match(routeSource, /isValidConnectionRoomId/);
  assert.match(routeSource, /requestedSessionId && !isValidConnectionRoomId\(requestedSessionId\)/);
  assert.match(
    routeSource,
    /const roomName = sessionId \? deriveLiveKitRoomName\(sessionId\) : requestedRoomName/
  );
  assert.match(routeSource, /dispatch_ids/);
});

test('session stop route pins the Next.js runtime to nodejs', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/stop/route.ts', import.meta.url),
    'utf8'
  );

  assert.match(routeSource, /export const runtime = 'nodejs'/);
});

test('session stop route deletes the LiveKit room after the dispatch barrier', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/stop/route.ts', import.meta.url),
    'utf8'
  );

  assert.match(routeSource, /await waitForPendingDispatches\(roomName, sessionId\)/);
  assert.match(routeSource, /await stopRoomInput\(roomName, sessionId\)/);
  assert.match(routeSource, /deleteLiveKitRoom\(roomName\)/);
});

test('session stop route waits on the dedicated agent log before finishing server cleanup', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/stop/route.ts', import.meta.url),
    'utf8'
  );
  const cleanupSource = routeSource.match(/async function runRemoteSessionCleanup[\s\S]*?\n}/)?.[0];

  assert.ok(cleanupSource, 'runRemoteSessionCleanup should be defined');
  assert.match(routeSource, /function waitForLocalAgentWorkerReadiness/);
  assert.match(routeSource, /process\.env\.LEXVOICE_RUN_LOG_DIR/);
  assert.match(routeSource, /live\.log/);
  assert.doesNotMatch(routeSource, /path\.join\(runLogDir, 'server\.log'\)/);
  assert.match(routeSource, /AGENT_WORKER_READINESS_TIMEOUT_MS/);
  assert.match(routeSource, /readFileTail\(logPath/);
  assert.match(routeSource, /waitForAgentWorkerAvailable/);
  assert.doesNotMatch(routeSource, /if \(state === 'unknown'\)/);
  assert.doesNotMatch(routeSource, /readFile\(logPath,\s*'utf8'\)/);
  assert.match(cleanupSource, /deleteLiveKitRoom\(roomName\)/);
  assert.match(cleanupSource, /await waitForLocalAgentWorkerReadiness\(\)/);
  assert.match(
    cleanupSource,
    /const cleanupResults = \[\s*dispatchBarrierResult,\s*\.\.\.roomInputResults,\s*liveKitRoomResult,\s*agentWorkerReadinessResult,\s*\]/
  );
});

test('session stop route does not report missing local worker evidence as ready', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/stop/route.ts', import.meta.url),
    'utf8'
  );

  assert.match(
    routeSource,
    /if \(!logPath \|\| !\(await fileExists\(logPath\)\)\) \{\s*return \{\s*target: 'agent_worker_readiness',\s*ok: false,\s*error: 'agent worker log unavailable',\s*\};\s*\}/
  );
});

test('session stop route waits for remote cleanup in every input source', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/stop/route.ts', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(routeSource, /function shouldDeferRemoteSessionCleanup/);
  assert.doesNotMatch(routeSource, /void runRemoteSessionCleanup/);
  assert.doesNotMatch(routeSource, /status: 'stopping'/);
  assert.doesNotMatch(routeSource, /deferred: true/);
  assert.doesNotMatch(routeSource, /\{ status: 202 \}/);
  assert.match(routeSource, /const \{ results, failures \} = await runRemoteSessionCleanup/);
});

test('session stop route closes the registry even when remote cleanup is partial', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/stop/route.ts', import.meta.url),
    'utf8'
  );
  const cleanupSource = routeSource.match(/async function runRemoteSessionCleanup[\s\S]*?\n}/)?.[0];

  assert.ok(cleanupSource, 'runRemoteSessionCleanup should be defined');
  assert.match(cleanupSource, /const failures = results\.filter/);
  assert.match(cleanupSource, /result\.fatal !== false/);
  assert.match(
    cleanupSource,
    /markRoomSessionStopped\(roomName, sessionId\);\s*return \{ results, failures \};/
  );
});

test('session stop route logs remote cleanup with canonical session identity', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/stop/route.ts', import.meta.url),
    'utf8'
  );
  const cleanupSource = routeSource.match(/async function runRemoteSessionCleanup[\s\S]*?\n}/)?.[0];

  assert.ok(cleanupSource, 'runRemoteSessionCleanup should be defined');
  assert.match(cleanupSource, /console\.info\('agent session remote cleanup completed'/);
  assert.match(cleanupSource, /roomName/);
  assert.match(cleanupSource, /sessionId/);
  assert.match(cleanupSource, /results/);
  assert.match(cleanupSource, /failures/);
});
