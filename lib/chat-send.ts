export class ChatSendTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Message send timed out after ${timeoutMs}ms`);
    this.name = 'ChatSendTimeoutError';
  }
}

export const CHAT_SEND_TIMEOUT_MS = 8_000;

export async function sendChatMessageWithTimeout(
  send: (message: string) => Promise<unknown> | unknown,
  message: string,
  timeoutMs: number = CHAT_SEND_TIMEOUT_MS
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new ChatSendTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    await Promise.race([Promise.resolve().then(() => send(message)), timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
