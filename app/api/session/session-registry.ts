export type RoomSessionState = 'starting' | 'running' | 'stopping' | 'stopped';

export type RoomSessionToken = {
  roomName: string;
  sessionId: string;
  generation: number;
};

export type RoomSessionSnapshot = {
  roomName: string;
  sessionId: string;
  agentName: string;
  generation: number;
  state: RoomSessionState;
  cancelled: boolean;
  dispatchIds: string[];
};

type RoomSessionRecord = {
  roomName: string;
  sessionId: string;
  agentName: string;
  generation: number;
  state: RoomSessionState;
  cancelled: boolean;
  dispatchIds: Set<string>;
  activeDispatches: number;
  dispatchWaiters: Set<() => void>;
};

const sessions = new Map<string, RoomSessionRecord>();
let nextGeneration = 1;

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function snapshot(record: RoomSessionRecord): RoomSessionSnapshot {
  return {
    roomName: record.roomName,
    sessionId: record.sessionId,
    agentName: record.agentName,
    generation: record.generation,
    state: record.state,
    cancelled: record.cancelled,
    dispatchIds: [...record.dispatchIds],
  };
}

function getMatchingRecord(token: RoomSessionToken): RoomSessionRecord | undefined {
  const record = sessions.get(token.roomName);
  if (!record) {
    return undefined;
  }
  if (record.sessionId !== token.sessionId || record.generation !== token.generation) {
    return undefined;
  }
  return record;
}

export function beginRoomSessionDispatch(
  roomName: string,
  sessionId: string,
  agentName: string
): RoomSessionToken {
  const normalizedRoomName = normalize(roomName);
  const normalizedSessionId = normalize(sessionId);
  const normalizedAgentName = normalize(agentName);
  const existing = sessions.get(normalizedRoomName);

  if (existing && existing.sessionId === normalizedSessionId) {
    existing.agentName = normalizedAgentName;
    existing.state = existing.cancelled ? 'stopping' : 'starting';
    existing.activeDispatches += 1;
    return {
      roomName: existing.roomName,
      sessionId: existing.sessionId,
      generation: existing.generation,
    };
  }

  const record: RoomSessionRecord = {
    roomName: normalizedRoomName,
    sessionId: normalizedSessionId,
    agentName: normalizedAgentName,
    generation: nextGeneration++,
    state: 'starting',
    cancelled: false,
    dispatchIds: new Set(),
    activeDispatches: 1,
    dispatchWaiters: new Set(),
  };
  sessions.set(normalizedRoomName, record);

  return {
    roomName: record.roomName,
    sessionId: record.sessionId,
    generation: record.generation,
  };
}

export function registerRoomSessionDispatchId(
  token: RoomSessionToken,
  dispatchId: string | null | undefined
): void {
  const normalizedDispatchId = normalize(dispatchId);
  if (!normalizedDispatchId) {
    return;
  }

  const record = getMatchingRecord(token);
  if (!record) {
    return;
  }

  record.dispatchIds.add(normalizedDispatchId);
}

export function isRoomSessionCancelled(token: RoomSessionToken): boolean {
  const record = getMatchingRecord(token);
  return !record || record.cancelled || record.state === 'stopping' || record.state === 'stopped';
}

export function markRoomSessionRunning(token: RoomSessionToken): void {
  const record = getMatchingRecord(token);
  if (!record || record.cancelled) {
    return;
  }

  record.state = 'running';
}

export function markRoomSessionStopping(
  roomName: string,
  sessionId?: string | null
): RoomSessionSnapshot {
  const normalizedRoomName = normalize(roomName);
  const normalizedSessionId = normalize(sessionId);
  let record = sessions.get(normalizedRoomName);

  if (!record) {
    record = {
      roomName: normalizedRoomName,
      sessionId: normalizedSessionId,
      agentName: '',
      generation: nextGeneration++,
      state: 'stopping',
      cancelled: true,
      dispatchIds: new Set(),
      activeDispatches: 0,
      dispatchWaiters: new Set(),
    };
    sessions.set(normalizedRoomName, record);
    return snapshot(record);
  }

  if (normalizedSessionId && record.sessionId !== normalizedSessionId) {
    record.sessionId = normalizedSessionId;
    record.generation = nextGeneration++;
    record.dispatchIds.clear();
  }

  record.state = 'stopping';
  record.cancelled = true;
  return snapshot(record);
}

export function markRoomSessionStopped(roomName: string, sessionId?: string | null): void {
  const normalizedRoomName = normalize(roomName);
  const normalizedSessionId = normalize(sessionId);
  const record = sessions.get(normalizedRoomName);
  if (!record) {
    return;
  }
  if (normalizedSessionId && record.sessionId !== normalizedSessionId) {
    return;
  }

  record.state = 'stopped';
  record.cancelled = true;
  record.dispatchIds.clear();
  record.activeDispatches = 0;
  record.dispatchWaiters.forEach((resolve) => resolve());
  record.dispatchWaiters.clear();
  sessions.delete(normalizedRoomName);
}

export function finishRoomSessionDispatch(token: RoomSessionToken): void {
  const record = getMatchingRecord(token);
  if (!record) {
    return;
  }

  record.activeDispatches = Math.max(0, record.activeDispatches - 1);
  if (record.activeDispatches === 0) {
    record.dispatchWaiters.forEach((resolve) => resolve());
    record.dispatchWaiters.clear();
  }

  record.dispatchIds.clear();
}

export function getRoomSessionSnapshot(roomName: string): RoomSessionSnapshot | undefined {
  const record = sessions.get(normalize(roomName));
  return record ? snapshot(record) : undefined;
}

export async function waitForRoomSessionDispatchesToFinish(
  roomName: string,
  sessionId?: string | null,
  timeoutMs = 1_500
): Promise<void> {
  const normalizedRoomName = normalize(roomName);
  const normalizedSessionId = normalize(sessionId);
  const record = sessions.get(normalizedRoomName);
  if (!record) {
    return;
  }
  if (normalizedSessionId && record.sessionId !== normalizedSessionId) {
    return;
  }
  if (record.activeDispatches <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timeout);
      record.dispatchWaiters.delete(done);
      resolve();
    };

    const timeout = setTimeout(done, timeoutMs);
    record.dispatchWaiters.add(done);
  });
}
