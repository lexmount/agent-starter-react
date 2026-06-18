export class LocalTargetClient {
  constructor({
    proxyBaseUrl = 'http://127.0.0.1:4003/',
    readyTimeoutMs = 10_000,
    readyPollMs = 500,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.proxyBaseUrl = ensureTrailingSlash(proxyBaseUrl);
    this.readyTimeoutMs = Number(readyTimeoutMs);
    this.readyPollMs = Number(readyPollMs);
    this.fetch = fetchImpl;
  }

  async createSandbox({ sessionId }) {
    await waitForHttpOk({
      url: this.proxyBaseUrl,
      fetchImpl: this.fetch,
      timeoutMs: this.readyTimeoutMs,
      pollMs: this.readyPollMs,
    });
    return {
      sandboxId: `local-${sessionId}`,
      proxyBaseUrl: this.proxyBaseUrl,
    };
  }

  async releaseSandbox() {
    return undefined;
  }
}

async function waitForHttpOk({ url, fetchImpl, timeoutMs, pollMs }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() <= deadline) {
    try {
      const response = await fetchImpl(url, { redirect: 'manual' });
      if (response.ok || response.status === 302 || response.status === 307) {
        return;
      }
      lastError = new Error(`ready check ${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(pollMs);
  }

  throw lastError || new Error(`timed out waiting for ${url}`);
}

function ensureTrailingSlash(value) {
  return String(value).endsWith('/') ? String(value) : `${value}/`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
