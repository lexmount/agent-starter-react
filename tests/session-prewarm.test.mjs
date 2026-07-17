import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { ParticipantInfo_Kind, ParticipantInfo_State, TrackType } from '@livekit/protocol';
import {
  beginPrewarmUse,
  buildPrewarmUseKey,
  completePrewarmUse,
  failPrewarmUse,
} from '@/app/api/session/prewarm/prewarm-use-guard';
import {
  resolveAgentWorkerReadyFile,
  waitForAgentWorkerReady,
} from '../app/api/session/agent-worker-readiness.ts';
import { POST as prewarmRoute } from '../app/api/session/prewarm/route.ts';
import {
  dispatchRoomSession,
  prewarmRoomSession,
} from '../app/api/session/session-dispatch-service.ts';
import { getRoomSessionSnapshot } from '../app/api/session/session-registry.ts';

function activeParticipant(identity, attributes = {}) {
  return {
    identity,
    kind: identity.startsWith('agent-')
      ? ParticipantInfo_Kind.AGENT
      : ParticipantInfo_Kind.STANDARD,
    state: ParticipantInfo_State.ACTIVE,
    attributes,
    tracks: [],
  };
}

function readyParticipants(agentName, { videoReady = false } = {}) {
  const videoParticipant = activeParticipant('room_video_input');
  if (videoReady) {
    videoParticipant.tracks = [{ name: 'room_video', type: TrackType.VIDEO, muted: false }];
  }
  return [
    activeParticipant('agent-ready', { 'lk.agent.name': agentName }),
    activeParticipant('room_audio_input'),
    videoParticipant,
  ];
}

test('prewarm route rejects requests without the per-sandbox secret', async () => {
  const previous = process.env.LIVEAVATAR_PREWARM_SECRET;
  process.env.LIVEAVATAR_PREWARM_SECRET = 'expected-prewarm-secret';
  try {
    const missing = await prewarmRoute(
      new Request('http://sandbox.example.test/api/session/prewarm', { method: 'POST' })
    );
    const wrong = await prewarmRoute(
      new Request('http://sandbox.example.test/api/session/prewarm', {
        method: 'POST',
        headers: { 'x-liveavatar-prewarm-secret': 'wrong-prewarm-secret' },
      })
    );

    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
  } finally {
    if (previous === undefined) {
      delete process.env.LIVEAVATAR_PREWARM_SECRET;
    } else {
      process.env.LIVEAVATAR_PREWARM_SECRET = previous;
    }
  }
});

test('prewarm authorization is single-use after success and retryable after failure', () => {
  const completedKey = buildPrewarmUseKey(
    'completed-session',
    'voice_assistant_room_completed-session',
    'frontdesk-browser-agent-completed-session'
  );
  assert.equal(beginPrewarmUse(completedKey), 'started');
  assert.equal(beginPrewarmUse(completedKey), 'in_progress');
  completePrewarmUse(completedKey);
  assert.equal(beginPrewarmUse(completedKey), 'completed');

  const retryableKey = buildPrewarmUseKey(
    'retryable-session',
    'voice_assistant_room_retryable-session',
    'frontdesk-browser-agent-retryable-session'
  );
  assert.equal(beginPrewarmUse(retryableKey), 'started');
  failPrewarmUse(retryableKey);
  assert.equal(beginPrewarmUse(retryableKey), 'started');
  failPrewarmUse(retryableKey);
});

test('prewarm route returns 409 after its server-owned authorization is consumed', async () => {
  const sessionId = 'a16e0a10-4f28-4a78-8f1f-019c25a273cb';
  const roomName = `voice_assistant_room_${sessionId}`;
  const agentName = 'frontdesk-browser-agent-consumed';
  const secret = 'consumed-prewarm-secret';
  const envNames = [
    'LIVEAVATAR_PREWARM_SECRET',
    'LIVEAVATAR_VOICE_SESSION_ID',
    'LIVEAVATAR_LIVEKIT_ROOM_NAME',
    'AGENT_NAME',
  ];
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    LIVEAVATAR_PREWARM_SECRET: secret,
    LIVEAVATAR_VOICE_SESSION_ID: sessionId,
    LIVEAVATAR_LIVEKIT_ROOM_NAME: roomName,
    AGENT_NAME: agentName,
  });

  const useKey = buildPrewarmUseKey(sessionId, roomName, agentName);
  assert.equal(beginPrewarmUse(useKey), 'started');
  completePrewarmUse(useKey);

  try {
    const response = await prewarmRoute(
      new Request('http://sandbox.example.test/api/session/prewarm', {
        method: 'POST',
        headers: { 'x-liveavatar-prewarm-secret': secret },
      })
    );

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      status: 'error',
      error: 'prewarm authorization already consumed',
    });
  } finally {
    for (const name of envNames) {
      if (previous[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous[name];
      }
    }
  }
});

test('missing LiveKit configuration fails before registering a room session', async () => {
  const names = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => delete process.env[name]);

  const request = {
    roomName: 'voice_assistant_room_missing_config',
    sessionId: 'missing-config',
    agentName: 'frontdesk-browser-agent-missing-config',
  };
  try {
    await assert.rejects(dispatchRoomSession(request), /LiveKit API configuration is required/);
    assert.equal(getRoomSessionSnapshot(request.roomName), undefined);
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

test('regular dispatch keeps the shorter timeout while prewarm gets a larger budget', async () => {
  const originalNow = Date.now;
  const originalTimeout = process.env.AGENT_DISPATCH_TIMEOUT_MS;
  let now = 1_000;
  let dispatchCount = 0;
  Date.now = () => now;
  delete process.env.AGENT_DISPATCH_TIMEOUT_MS;

  const dispatchClient = {
    async createDispatch() {
      dispatchCount += 1;
      return { id: `dispatch-timeout-${dispatchCount}` };
    },
    async deleteDispatch() {},
  };
  const roomClient = {
    async listRooms([roomName]) {
      return [{ name: roomName }];
    },
    async createRoom({ name }) {
      return { name };
    },
    async listParticipants() {
      return [];
    },
    async deleteRoom() {},
  };
  const dependencies = {
    dispatchClient,
    roomClient,
    dispatchPollMs: 1_000,
    dispatchRetryMs: 1_000,
    sleep: async (ms) => {
      now += ms;
    },
    waitForAgentWorkerReady: async () => ({ state: 'not_required' }),
  };

  try {
    const regularStartedAt = now;
    await assert.rejects(
      dispatchRoomSession(
        {
          roomName: 'voice_assistant_room_regular_timeout',
          sessionId: 'regular-timeout',
          agentName: 'frontdesk-browser-agent-regular-timeout',
        },
        dependencies
      ),
      /agent dispatch failed/
    );
    assert.equal(now - regularStartedAt, 8_000);

    const prewarmStartedAt = now;
    await assert.rejects(
      prewarmRoomSession(
        {
          roomName: 'voice_assistant_room_prewarm_timeout',
          sessionId: 'prewarm-timeout',
          agentName: 'frontdesk-browser-agent-prewarm-timeout',
        },
        dependencies
      ),
      /agent dispatch failed/
    );
    assert.equal(now - prewarmStartedAt, 20_000);
  } finally {
    Date.now = originalNow;
    if (originalTimeout === undefined) {
      delete process.env.AGENT_DISPATCH_TIMEOUT_MS;
    } else {
      process.env.AGENT_DISPATCH_TIMEOUT_MS = originalTimeout;
    }
  }
});

test('concurrent prewarm dispatch calls share one LiveKit dispatch', async () => {
  const agentName = 'frontdesk-browser-agent-concurrent';
  let dispatchCalls = 0;
  let ready = false;
  let releaseDispatch;
  const dispatchGate = new Promise((resolve) => {
    releaseDispatch = resolve;
  });
  const dispatchClient = {
    async createDispatch() {
      dispatchCalls += 1;
      await dispatchGate;
      ready = true;
      return { id: 'dispatch-concurrent' };
    },
    async deleteDispatch() {},
  };
  const roomClient = {
    async listParticipants() {
      return ready ? readyParticipants(agentName) : [];
    },
    async listRooms() {
      return [{ name: 'voice_assistant_room_concurrent' }];
    },
    async createRoom() {
      throw new Error('room already exists');
    },
    async deleteRoom() {},
  };
  const request = {
    roomName: 'voice_assistant_room_concurrent',
    sessionId: 'concurrent',
    agentName,
    readiness: { requireRoomInputParticipantsReady: true },
  };

  const first = dispatchRoomSession(request, { dispatchClient, roomClient });
  const second = dispatchRoomSession(request, { dispatchClient, roomClient });
  releaseDispatch();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(dispatchCalls, 1);
  assert.deepEqual(secondResult, firstResult);
  assert.equal(firstResult.dispatchId, 'dispatch-concurrent');
});

test('a concurrent prewarm budget extends the shared in-flight dispatch', async () => {
  const originalNow = Date.now;
  let now = 1_000;
  let dispatchCalls = 0;
  Date.now = () => now;

  const dispatchClient = {
    async createDispatch() {
      dispatchCalls += 1;
      return { id: 'dispatch-shared-budget' };
    },
    async deleteDispatch() {},
  };
  const roomClient = {
    async listParticipants() {
      return [];
    },
    async deleteRoom() {},
  };
  const dependencies = {
    dispatchClient,
    roomClient,
    dispatchPollMs: 1_000,
    dispatchRetryMs: 1_000,
    sleep: async (ms) => {
      now += ms;
    },
  };
  const request = {
    roomName: 'voice_assistant_room_shared_budget',
    sessionId: 'shared-budget',
    agentName: 'frontdesk-browser-agent-shared-budget',
  };

  try {
    const startedAt = now;
    const regularDispatch = dispatchRoomSession(request, {
      ...dependencies,
      dispatchTimeoutMs: 8_000,
    });
    const prewarmDispatch = dispatchRoomSession(request, {
      ...dependencies,
      dispatchTimeoutMs: 20_000,
    });
    const results = await Promise.allSettled([regularDispatch, prewarmDispatch]);

    assert.equal(dispatchCalls, 1);
    assert.equal(now - startedAt, 20_000);
    for (const result of results) {
      assert.equal(result.status, 'rejected');
      assert.match(result.reason.message, /agent dispatch failed/);
    }
  } finally {
    Date.now = originalNow;
  }
});

test('concurrent dispatch callers wait for their own readiness contract', async () => {
  const agentName = 'frontdesk-browser-agent-readiness-contract';
  let dispatchCalls = 0;
  let agentReady = false;
  let videoReady = false;
  let releaseDispatch;
  let releaseVideo;
  let markVideoWaitStarted;
  const dispatchGate = new Promise((resolve) => {
    releaseDispatch = resolve;
  });
  const videoGate = new Promise((resolve) => {
    releaseVideo = resolve;
  });
  const videoWaitStarted = new Promise((resolve) => {
    markVideoWaitStarted = resolve;
  });
  const dispatchClient = {
    async createDispatch() {
      dispatchCalls += 1;
      await dispatchGate;
      agentReady = true;
      return { id: 'dispatch-readiness-contract' };
    },
    async deleteDispatch() {},
  };
  const roomClient = {
    async listParticipants() {
      return agentReady ? readyParticipants(agentName, { videoReady }) : [];
    },
    async listRooms() {
      return [{ name: 'voice_assistant_room_readiness_contract' }];
    },
    async createRoom() {
      throw new Error('room already exists');
    },
    async deleteRoom() {},
  };
  const request = {
    roomName: 'voice_assistant_room_readiness_contract',
    sessionId: 'readiness-contract',
    agentName,
  };

  const prewarm = dispatchRoomSession(
    { ...request, readiness: { requireRoomInputParticipantsReady: true } },
    { dispatchClient, roomClient, dispatchTimeoutMs: 100 }
  );
  const browserDispatch = dispatchRoomSession(
    { ...request, readiness: { requireRoomVideoInputReady: true } },
    {
      dispatchClient,
      roomClient,
      dispatchTimeoutMs: 100,
      dispatchPollMs: 1,
      sleep: async () => {
        markVideoWaitStarted();
        await videoGate;
      },
    }
  );

  releaseDispatch();
  const prewarmResult = await prewarm;
  await videoWaitStarted;
  assert.equal(dispatchCalls, 1);
  assert.equal(prewarmResult.dispatchId, 'dispatch-readiness-contract');

  videoReady = true;
  releaseVideo();
  const browserResult = await browserDispatch;

  assert.equal(dispatchCalls, 1);
  assert.equal(browserResult.dispatchId, 'dispatch-readiness-contract');
});

test('shared dispatch token stays active through per-caller readiness waits', async () => {
  const source = await readFile(
    new URL('../app/api/session/session-dispatch-service.ts', import.meta.url),
    'utf8'
  );
  const dispatchSource = source.slice(
    source.indexOf('export async function dispatchRoomSession'),
    source.indexOf('async function waitForRequestedRoomSessionReadiness')
  );
  const readinessSource = source.slice(
    source.indexOf('async function waitForRequestedRoomSessionReadiness'),
    source.indexOf('export async function prewarmRoomSession')
  );

  assert.match(
    dispatchSource,
    /inFlight\.callers === 0[\s\S]*finishRoomSessionDispatch\(inFlight\.session\)/
  );
  assert.doesNotMatch(readinessSource, /beginRoomSessionDispatch|finishRoomSessionDispatch/);
});

test('prewarm creates the room and waits for both room input participants', async () => {
  const agentName = 'frontdesk-browser-agent-readiness';
  let roomCreated = false;
  let workerReady = false;
  let dispatchCreated = false;
  let visionReady = false;
  const dispatchClient = {
    async createDispatch() {
      assert.equal(workerReady, true);
      dispatchCreated = true;
      return { id: 'dispatch-readiness' };
    },
    async deleteDispatch() {},
  };
  const roomClient = {
    async listRooms() {
      return roomCreated ? [{ name: 'voice_assistant_room_readiness' }] : [];
    },
    async createRoom({ name }) {
      roomCreated = true;
      return { name };
    },
    async listParticipants() {
      if (!dispatchCreated) {
        return [];
      }
      return readyParticipants(agentName).filter(
        (participant) => visionReady || participant.identity !== 'room_video_input'
      );
    },
    async deleteRoom() {},
  };

  const result = await prewarmRoomSession(
    {
      roomName: 'voice_assistant_room_readiness',
      sessionId: 'readiness',
      agentName,
    },
    {
      dispatchClient,
      roomClient,
      waitForAgentWorkerReady: async (requestedAgentName) => {
        assert.equal(roomCreated, true);
        assert.equal(requestedAgentName, agentName);
        workerReady = true;
        return {
          state: 'ready',
          agentName,
          workerId: 'AW_readiness',
          registeredAt: '2026-07-13T00:00:00Z',
          waitedMs: 7,
        };
      },
      dispatchTimeoutMs: 100,
      dispatchPollMs: 1,
      sleep: async () => {
        visionReady = true;
      },
    }
  );

  assert.equal(roomCreated, true);
  assert.equal(result.workerReadiness.workerId, 'AW_readiness');
  assert.equal(result.dispatch.dispatchId, 'dispatch-readiness');
  assert.deepEqual(result.readiness, {
    audioParticipantReady: true,
    visionParticipantReady: true,
  });
});

test('repeated prewarm reuses ready participants without creating another dispatch', async () => {
  const agentName = 'frontdesk-browser-agent-idempotent';
  let dispatchCalls = 0;
  const dispatchClient = {
    async createDispatch() {
      dispatchCalls += 1;
      return { id: 'unexpected-dispatch' };
    },
    async deleteDispatch() {},
  };
  const roomClient = {
    async listRooms() {
      return [{ name: 'voice_assistant_room_idempotent' }];
    },
    async createRoom() {
      throw new Error('room already exists');
    },
    async listParticipants() {
      return readyParticipants(agentName);
    },
    async deleteRoom() {},
  };
  const request = {
    roomName: 'voice_assistant_room_idempotent',
    sessionId: 'idempotent',
    agentName,
  };
  const dependencies = {
    dispatchClient,
    roomClient,
    waitForAgentWorkerReady: async () => ({ state: 'not_required' }),
  };

  const first = await prewarmRoomSession(request, dependencies);
  const second = await prewarmRoomSession(request, dependencies);

  assert.equal(first.dispatch.alreadyJoined, true);
  assert.equal(second.dispatch.alreadyJoined, true);
  assert.equal(dispatchCalls, 0);
});

test('sandbox worker readiness resolves to the shared workspace marker', () => {
  assert.equal(
    resolveAgentWorkerReadyFile({
      LIVEAVATAR_RUNTIME_MODE: 'sandbox',
      LIVEAVATAR_SANDBOX_WORKSPACE_DATA_DIR: '/workspace/test-data',
    }),
    '/workspace/test-data/logs/sandbox/agent-worker-ready.json'
  );
  assert.equal(resolveAgentWorkerReadyFile({ LIVEAVATAR_RUNTIME_MODE: 'local' }), '');
});

test('worker readiness ignores stale agent markers and waits for the expected worker', async () => {
  let reads = 0;
  const readiness = await waitForAgentWorkerReady('frontdesk-browser-agent-current', {
    readyFile: '/tmp/agent-worker-ready.json',
    timeoutMs: 100,
    pollMs: 1,
    readFile: async () => {
      reads += 1;
      return JSON.stringify({
        version: 1,
        agentName:
          reads === 1 ? 'frontdesk-browser-agent-stale' : 'frontdesk-browser-agent-current',
        workerId: reads === 1 ? 'AW_stale' : 'AW_current',
        registeredAt: '2026-07-13T00:00:00Z',
      });
    },
    sleep: async () => undefined,
  });

  assert.equal(reads, 2);
  assert.equal(readiness.state, 'ready');
  assert.equal(readiness.workerId, 'AW_current');
});
