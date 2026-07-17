type PrewarmUseState = 'started' | 'in_progress' | 'completed';

const prewarmUseStates = new Map<string, Exclude<PrewarmUseState, 'started'>>();

export function buildPrewarmUseKey(sessionId: string, roomName: string, agentName: string) {
  return `${sessionId}\u0000${roomName}\u0000${agentName}`;
}

export function beginPrewarmUse(key: string): PrewarmUseState {
  const state = prewarmUseStates.get(key);
  if (state) {
    return state;
  }

  prewarmUseStates.set(key, 'in_progress');
  return 'started';
}

export function completePrewarmUse(key: string) {
  if (prewarmUseStates.get(key) === 'in_progress') {
    prewarmUseStates.set(key, 'completed');
  }
}

export function failPrewarmUse(key: string) {
  if (prewarmUseStates.get(key) === 'in_progress') {
    prewarmUseStates.delete(key);
  }
}
