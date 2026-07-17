type PrewarmUseState = 'started' | 'in_progress' | 'completed';
type PrewarmUseStates = Map<string, Exclude<PrewarmUseState, 'started'>>;

const globalForPrewarmUse = globalThis as typeof globalThis & {
  __liveavatarPrewarmUseStates?: PrewarmUseStates;
};

// Keep one authorization state even if the Next.js server loads this module in multiple chunks.
const prewarmUseStates =
  globalForPrewarmUse.__liveavatarPrewarmUseStates ??
  (globalForPrewarmUse.__liveavatarPrewarmUseStates = new Map());

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
