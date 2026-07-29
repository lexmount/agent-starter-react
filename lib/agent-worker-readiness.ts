export type AgentWorkerState = 'available' | 'unavailable' | 'unknown';

type AgentWorkerWaitOptions = {
  timeoutMs: number;
  pollMs: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export function readAgentWorkerStateFromLog(source: string): AgentWorkerState {
  let state: AgentWorkerState = 'unknown';
  const registeredPattern = /\bregistered worker\b/;
  const availablePattern = /\bworker is below capacity, marking as available\b/;
  const unavailablePattern = /\bworker is at full capacity, marking as unavailable\b/;

  for (const line of source.split(/\r?\n/)) {
    if (availablePattern.test(line)) {
      state = 'available';
    } else if (unavailablePattern.test(line)) {
      state = 'unavailable';
    } else if (state === 'unknown' && registeredPattern.test(line)) {
      state = 'available';
    }
  }

  return state;
}

export async function waitForAgentWorkerAvailable(
  readState: () => Promise<AgentWorkerState>,
  options: AgentWorkerWaitOptions
): Promise<boolean> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }));
  const deadline = now() + options.timeoutMs;

  while (true) {
    if ((await readState()) === 'available') {
      return true;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      return false;
    }
    await sleep(Math.min(options.pollMs, remainingMs));
  }
}
