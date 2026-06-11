type DispatchOptions = {
  signal?: AbortSignal;
};

export class AgentSessionDispatchCancelledError extends Error {
  constructor() {
    super('agent session dispatch was cancelled');
    this.name = 'AgentSessionDispatchCancelledError';
  }
}

export async function requestAgentSessionDispatch(
  roomName?: string | null,
  agentName?: string | null,
  sessionId?: string | null,
  options: DispatchOptions = {}
): Promise<void> {
  const normalizedRoomName = roomName?.trim();
  const normalizedAgentName = agentName?.trim();
  const normalizedSessionId = sessionId?.trim();
  if (!normalizedRoomName || !normalizedAgentName || !normalizedSessionId) {
    return;
  }

  const response = await fetch('/api/session/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomName: normalizedRoomName,
      agentName: normalizedAgentName,
      sessionId: normalizedSessionId,
    }),
    signal: options.signal,
  });

  if (response.status === 409) {
    throw new AgentSessionDispatchCancelledError();
  }

  if (!response.ok) {
    throw new Error(`agent session dispatch failed: ${response.status}`);
  }
}
