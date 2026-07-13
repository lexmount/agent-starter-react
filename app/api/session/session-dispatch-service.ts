import { AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';
import { type ParticipantInfo } from '@livekit/protocol';
import {
  type ReusableAgentParticipantOptions,
  findReusableAgentParticipant as findReusableAgentParticipantInList,
  summarizeRoomInputReadiness,
} from '@/lib/session-dispatch-readiness';
import { resolveLiveKitHttpUrl } from '@/lib/session-stop';
import { type AgentWorkerReadiness, waitForAgentWorkerReady } from './agent-worker-readiness';
import {
  type RoomSessionToken,
  beginRoomSessionDispatch,
  finishRoomSessionDispatch,
  isRoomSessionCancelled,
  markRoomSessionRunning,
  registerRoomSessionDispatchId,
} from './session-registry';

type DispatchClient = Pick<AgentDispatchClient, 'createDispatch' | 'deleteDispatch'>;
type RoomClient = Pick<
  RoomServiceClient,
  'createRoom' | 'deleteRoom' | 'listParticipants' | 'listRooms'
>;

type DispatchDependencies = {
  dispatchClient?: DispatchClient;
  roomClient?: RoomClient;
  dispatchTimeoutMs?: number;
  dispatchRetryMs?: number;
  dispatchPollMs?: number;
  sleep?: (ms: number) => Promise<unknown>;
  waitForAgentWorkerReady?: (agentName: string) => Promise<AgentWorkerReadiness>;
};

export type DispatchRoomSessionRequest = {
  roomName: string;
  sessionId: string;
  agentName: string;
  readiness?: ReusableAgentParticipantOptions;
};

export class RoomSessionCancelledError extends Error {
  constructor(session: RoomSessionToken) {
    super(
      `room session was cancelled for sessionId=${session.sessionId} roomName=${session.roomName}`
    );
    this.name = 'RoomSessionCancelledError';
  }
}

const inFlightDispatches = new Map<string, Promise<Record<string, unknown>>>();

export async function dispatchRoomSession(
  request: DispatchRoomSessionRequest,
  dependencies: DispatchDependencies = {}
) {
  const key = `${request.sessionId}\u0000${request.roomName}\u0000${request.agentName}`;
  const existing = inFlightDispatches.get(key);
  if (existing) {
    return existing;
  }

  const operation = runRoomSessionDispatch(request, dependencies);
  inFlightDispatches.set(key, operation);
  try {
    return await operation;
  } finally {
    if (inFlightDispatches.get(key) === operation) {
      inFlightDispatches.delete(key);
    }
  }
}

export async function prewarmRoomSession(
  request: Omit<DispatchRoomSessionRequest, 'readiness'>,
  dependencies: DispatchDependencies = {}
) {
  const clients = resolveClients(dependencies);
  const room = await ensureLiveKitRoom(clients.roomClient, request.roomName);
  const workerReadiness = await (dependencies.waitForAgentWorkerReady || waitForAgentWorkerReady)(
    request.agentName
  );
  const dispatch = await dispatchRoomSession(
    {
      ...request,
      readiness: { requireRoomInputParticipantsReady: true },
    },
    { ...dependencies, ...clients }
  );
  const participants = await clients.roomClient.listParticipants(request.roomName);
  return {
    room: { name: room.name },
    workerReadiness,
    dispatch,
    readiness: summarizeRoomInputReadiness(participants),
  };
}

async function runRoomSessionDispatch(
  request: DispatchRoomSessionRequest,
  dependencies: DispatchDependencies
) {
  const { roomName, sessionId, agentName, readiness = {} } = request;
  const clients = resolveClients(dependencies);
  const session = beginRoomSessionDispatch(roomName, sessionId, agentName);
  try {
    const dispatch = await createAgentDispatchWithRetry(
      clients.dispatchClient,
      clients.roomClient,
      roomName,
      agentName,
      session,
      readiness,
      {
        timeoutMs: dependencies.dispatchTimeoutMs,
        retryMs: dependencies.dispatchRetryMs,
        pollMs: dependencies.dispatchPollMs,
        sleep: dependencies.sleep,
      }
    );
    console.info('agent session dispatch completed', {
      roomName,
      sessionId,
      agentName,
      dispatch,
    });
    return dispatch;
  } finally {
    finishRoomSessionDispatch(session);
  }
}

function resolveClients(dependencies: DispatchDependencies): {
  dispatchClient: DispatchClient;
  roomClient: RoomClient;
} {
  if (dependencies.dispatchClient && dependencies.roomClient) {
    return {
      dispatchClient: dependencies.dispatchClient,
      roomClient: dependencies.roomClient,
    };
  }

  const liveKitHttpUrl = resolveLiveKitHttpUrl(process.env.LIVEKIT_URL);
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!liveKitHttpUrl || !apiKey || !apiSecret) {
    throw new Error('LiveKit API configuration is required');
  }

  return {
    dispatchClient:
      dependencies.dispatchClient || new AgentDispatchClient(liveKitHttpUrl, apiKey, apiSecret),
    roomClient: dependencies.roomClient || new RoomServiceClient(liveKitHttpUrl, apiKey, apiSecret),
  };
}

async function ensureLiveKitRoom(roomClient: RoomClient, roomName: string) {
  const existing = await roomClient.listRooms([roomName]);
  if (existing.length > 0) {
    return existing[0];
  }

  try {
    return await roomClient.createRoom({ name: roomName });
  } catch (error) {
    const raced = await roomClient.listRooms([roomName]);
    if (raced.length > 0) {
      return raced[0];
    }
    throw error;
  }
}

async function createAgentDispatchWithRetry(
  dispatchClient: DispatchClient,
  roomClient: RoomClient,
  roomName: string,
  agentName: string,
  session: RoomSessionToken,
  reusableAgentOptions: ReusableAgentParticipantOptions,
  options: {
    timeoutMs?: number;
    retryMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<unknown>;
  }
) {
  const timeoutMs = options.timeoutMs || readPositiveIntEnv('AGENT_DISPATCH_TIMEOUT_MS', 20_000);
  const retryMs = options.retryMs || readPositiveIntEnv('AGENT_DISPATCH_RETRY_MS', 500);
  const pollMs = options.pollMs || readPositiveIntEnv('AGENT_DISPATCH_POLL_MS', 200);
  const sleepFn = options.sleep || sleep;
  const startedAt = Date.now();
  let lastError: unknown;
  let attempts = 0;
  let dispatchId = '';

  do {
    try {
      throwIfSessionCancelled(session);
      const alreadyJoined = await findReusableAgentParticipant(
        roomClient,
        roomName,
        agentName,
        reusableAgentOptions
      );
      throwIfSessionCancelled(session);
      if (alreadyJoined) {
        markRoomSessionRunning(session);
        return {
          attempts,
          alreadyJoined: true,
          agentParticipant: summarizeAgentParticipant(alreadyJoined),
        };
      }

      if (!dispatchId) {
        const dispatch = await dispatchClient.createDispatch(roomName, agentName);
        attempts += 1;
        dispatchId = dispatch.id;
        registerRoomSessionDispatchId(session, dispatchId);
      }

      if (isRoomSessionCancelled(session)) {
        await deleteDispatchQuietly(dispatchClient, dispatchId, roomName);
        await deleteLiveKitRoomQuietly(roomClient, roomName);
        throw new RoomSessionCancelledError(session);
      }

      const agentParticipant = await waitForReusableAgentParticipant(
        roomClient,
        roomName,
        agentName,
        reusableAgentOptions,
        remainingDispatchTime(startedAt, timeoutMs),
        pollMs,
        session,
        sleepFn
      );
      if (agentParticipant) {
        throwIfSessionCancelled(session);
        markRoomSessionRunning(session);
        return {
          attempts,
          dispatchId,
          agentParticipant: summarizeAgentParticipant(agentParticipant),
        };
      }

      lastError = new Error('agent and required room inputs did not become ready');
    } catch (error) {
      if (error instanceof RoomSessionCancelledError) {
        throw error;
      }
      lastError = error;
      const waitMs = Math.min(
        calculateDispatchRetryDelay(attempts, retryMs, timeoutMs),
        remainingDispatchTime(startedAt, timeoutMs)
      );
      if (waitMs > 0) {
        await sleepFn(waitMs);
      }
    }
  } while (Date.now() - startedAt < timeoutMs);

  await deleteDispatchQuietly(dispatchClient, dispatchId, roomName);
  throw new Error(
    `agent dispatch failed for ${agentName} after ${attempts} attempt(s): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

function remainingDispatchTime(startedAt: number, timeoutMs: number) {
  return Math.max(0, timeoutMs - (Date.now() - startedAt));
}

function calculateDispatchRetryDelay(attempts: number, retryMs: number, timeoutMs: number) {
  const multiplier = 2 ** Math.max(0, attempts - 1);
  return Math.min(retryMs * multiplier, timeoutMs);
}

async function waitForReusableAgentParticipant(
  roomClient: RoomClient,
  roomName: string,
  agentName: string,
  readiness: ReusableAgentParticipantOptions,
  maxWaitMs: number,
  pollMs: number,
  session: RoomSessionToken,
  sleepFn: (ms: number) => Promise<unknown>
) {
  const deadline = Date.now() + maxWaitMs;
  do {
    throwIfSessionCancelled(session);
    const participant = await findReusableAgentParticipant(roomClient, roomName, agentName, {
      allowAnonymousLiveKitAgentFallback: true,
      ...readiness,
    });
    if (participant) {
      throwIfSessionCancelled(session);
      return participant;
    }
    const waitMs = Math.min(pollMs, deadline - Date.now());
    if (waitMs > 0) {
      await sleepFn(waitMs);
    }
  } while (Date.now() < deadline);

  throwIfSessionCancelled(session);
  return findReusableAgentParticipant(roomClient, roomName, agentName, {
    allowAnonymousLiveKitAgentFallback: true,
    ...readiness,
  });
}

async function findReusableAgentParticipant(
  roomClient: RoomClient,
  roomName: string,
  agentName: string,
  options: ReusableAgentParticipantOptions = {}
) {
  const participants = await roomClient.listParticipants(roomName);
  return findReusableAgentParticipantInList(participants, agentName, options);
}

function summarizeAgentParticipant(participant: ParticipantInfo | null) {
  return participant ? { identity: participant.identity } : null;
}

async function deleteDispatchQuietly(
  dispatchClient: DispatchClient,
  dispatchId: string,
  roomName: string
) {
  if (!dispatchId) {
    return;
  }
  try {
    await dispatchClient.deleteDispatch(dispatchId, roomName);
  } catch {
    // The dispatch may already have been consumed or cleaned up by LiveKit.
  }
}

async function deleteLiveKitRoomQuietly(roomClient: RoomClient, roomName: string) {
  try {
    await roomClient.deleteRoom(roomName);
  } catch {
    // The room may already be gone because /stop won the race.
  }
}

function throwIfSessionCancelled(session: RoomSessionToken): void {
  if (isRoomSessionCancelled(session)) {
    throw new RoomSessionCancelledError(session);
  }
}

function readPositiveIntEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
