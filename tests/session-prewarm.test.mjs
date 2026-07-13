import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ParticipantInfo_Kind, ParticipantInfo_State } from '@livekit/protocol';
import {
  resolveAgentWorkerReadyFile,
  waitForAgentWorkerReady,
} from '../app/api/session/agent-worker-readiness.ts';
import { POST as prewarmRoute } from '../app/api/session/prewarm/route.ts';
import {
  dispatchRoomSession,
  prewarmRoomSession,
} from '../app/api/session/session-dispatch-service.ts';

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

function readyParticipants(agentName) {
  return [
    activeParticipant('agent-ready', { 'lk.agent.name': agentName }),
    activeParticipant('room_audio_input'),
    activeParticipant('room_video_input'),
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
