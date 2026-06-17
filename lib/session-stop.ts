export interface RoomInputStopPayload {
  room_name: string;
  session_id?: string;
}

export function resolveRoomInputStopUrl(roomInputUrl?: string | null): string | undefined {
  const normalized = roomInputUrl?.trim().replace(/\/+$/, '');
  if (!normalized) {
    return undefined;
  }
  if (normalized.endsWith('/start')) {
    return `${normalized.slice(0, -'/start'.length)}/stop`;
  }
  return `${normalized}/stop`;
}

export function buildRoomInputStopPayload(
  roomName: string,
  sessionId?: string | null
): RoomInputStopPayload {
  const normalizedSessionId = sessionId?.trim();
  return {
    room_name: roomName,
    ...(normalizedSessionId ? { session_id: normalizedSessionId } : {}),
  };
}

export function resolveLiveKitHttpUrl(liveKitUrl?: string | null): string | undefined {
  const normalized = liveKitUrl?.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.startsWith('wss://')) {
    return `https://${normalized.slice('wss://'.length)}`;
  }
  if (normalized.startsWith('ws://')) {
    return `http://${normalized.slice('ws://'.length)}`;
  }
  return normalized;
}
