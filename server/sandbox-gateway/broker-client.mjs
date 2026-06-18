export class BrokerClient {
  constructor({
    baseUrl,
    token,
    templateId = '',
    tenantId = 'lexmount',
    port = 4003,
    healthPort = 49999,
    extraPorts = [],
    readyTimeoutMs = 90_000,
    readyPollMs = 1_000,
    proxyBaseTemplate = '',
    env = {},
    fetchImpl = globalThis.fetch,
    logger = () => undefined,
  }) {
    this.baseUrl = stripTrailingSlash(baseUrl);
    this.token = token;
    this.templateId = templateId;
    this.tenantId = tenantId;
    this.port = Number(port);
    this.healthPort = Number(healthPort);
    this.extraPorts = extraPorts.map(Number).filter((port) => Number.isFinite(port) && port > 0);
    this.readyTimeoutMs = Number(readyTimeoutMs);
    this.readyPollMs = Number(readyPollMs);
    this.proxyBaseTemplate = proxyBaseTemplate;
    this.env = { ...env };
    this.fetch = fetchImpl;
    this.logger = logger;
  }

  async createSandbox({ sessionId, ttlSeconds, warmupFullBody = false }) {
    if (!this.templateId) {
      throw new Error('SANDBOX_TEMPLATE_ID is required');
    }
    const startedAt = Date.now();
    this.log('info', 'broker.create.start', {
      sessionId,
      templateId: this.templateId,
      tenantId: this.tenantId,
      ttlSeconds,
      uiPort: this.port,
      healthPort: this.healthPort,
    });

    const payload = {
      template_id: this.templateId,
      tenant_id: this.tenantId,
      session_id: sessionId,
      source: 'agent-starter-react-sandbox-gateway',
      description: `liveavatar ${sessionId}`,
      lifetime_sec: ttlSeconds,
      ports: this.resolveRequestedPorts(),
      allow_internet_access: true,
      metadata: {
        app: 'liveavatar',
        gateway: 'agent-starter-react',
      },
    };
    if (Object.keys(this.env).length > 0) {
      payload.env_vars = this.env;
    }

    const data = await this.createSandboxWithRecovery({ payload, sessionId });
    const acceptedAt = Date.now();
    const sandboxId = data.sandbox_id || data.sandboxId || data.id;
    if (!sandboxId) {
      throw new Error('broker did not return sandbox id');
    }
    this.log('info', 'broker.create.accepted', {
      sessionId,
      sandboxId,
      uiPort: this.port,
      healthPort: this.healthPort,
      durationMs: acceptedAt - startedAt,
    });

    const proxyBaseUrl = this.resolveProxyBaseUrl(data, sandboxId, this.port);
    try {
      const ready = await this.waitForSandboxReady(data, sandboxId, proxyBaseUrl, {
        warmupFullBody,
      });
      const readyAt = Date.now();
      this.log('info', 'broker.ready', {
        sessionId,
        sandboxId,
        uiPort: this.port,
        healthPort: this.healthPort,
        durationMs: readyAt - startedAt,
        readyDurationMs: readyAt - acceptedAt,
        healthReadyMs: ready.health?.durationMs ?? null,
        healthAttempts: ready.health?.attempts ?? null,
        uiReadyMs: ready.ui.durationMs,
        uiAttempts: ready.ui.attempts,
        uiWarmupBodyMs: ready.ui.bodyMs ?? null,
        uiWarmupBytes: ready.ui.bodyBytes ?? null,
      });
    } catch (error) {
      this.log('error', 'broker.ready.failed', {
        sessionId,
        sandboxId,
        durationMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
      await this.releaseSandbox(sandboxId).catch(() => undefined);
      throw error;
    }

    return { sandboxId, proxyBaseUrl };
  }

  resolveRequestedPorts() {
    const envRoomInputPort = Number(this.env.ROOM_INPUT_PORT);
    return [
      ...new Set(
        [this.port, this.healthPort, envRoomInputPort, ...this.extraPorts].filter(
          (port) => Number.isFinite(port) && port > 0
        )
      ),
    ];
  }

  async releaseSandbox(sandboxId) {
    const encodedSandboxId = encodeURIComponent(sandboxId);
    this.log('info', 'broker.release.start', { sandboxId });
    await this.request(`/v1/sandboxes/${encodedSandboxId}/terminate`, {
      method: 'POST',
    });
    this.log('info', 'broker.release.done', { sandboxId });
  }

  async createSandboxWithRecovery({ payload, sessionId }) {
    const startedAt = Date.now();
    try {
      const data = await this.request('/v1/sandboxes', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      this.log('info', 'broker.create.post.done', {
        sessionId,
        durationMs: Date.now() - startedAt,
      });
      return data;
    } catch (error) {
      if (error.code !== 'BROKER_FETCH_FAILED') {
        throw error;
      }

      this.log('error', 'broker.create.fetch_failed', {
        sessionId,
        durationMs: Date.now() - startedAt,
        message: error.message,
        cause: error.cause instanceof Error ? error.cause.message : '',
        code: error.cause?.code || '',
      });

      await sleep(Math.min(this.readyPollMs, 1_000));
      const existing = await this.findSandboxBySessionId(sessionId).catch((lookupError) => {
        this.log('error', 'broker.create.lookup_failed', {
          sessionId,
          message: lookupError instanceof Error ? lookupError.message : String(lookupError),
        });
        return null;
      });
      if (existing) {
        this.log('info', 'broker.create.recovered', {
          sessionId,
          sandboxId: existing.sandbox_id || existing.sandboxId || existing.id,
        });
        return existing;
      }

      this.log('info', 'broker.create.retry', { sessionId });
      const retryStartedAt = Date.now();
      const data = await this.request('/v1/sandboxes', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      this.log('info', 'broker.create.retry.done', {
        sessionId,
        durationMs: Date.now() - retryStartedAt,
      });
      return data;
    }
  }

  async findSandboxBySessionId(sessionId) {
    const data = await this.request('/v1/sandboxes', { method: 'GET' });
    const items = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
    return (
      items.find(
        (item) =>
          (item.session_id === sessionId || item.sessionId === sessionId) &&
          !['terminated', 'failed'].includes(String(item.status || item.sandboxStatus || ''))
      ) || null
    );
  }

  log(level, event, details = {}) {
    try {
      this.logger(level, event, details);
    } catch {
      // Logging must never affect sandbox lifecycle operations.
    }
  }

  resolveProxyBaseUrl(data, sandboxId, port = this.port) {
    const accessUrls = data.access_urls || data.accessUrls;
    const direct = accessUrls?.[String(port)] || accessUrls?.[port];
    if (direct) {
      return ensureTrailingSlash(direct);
    }

    const endpoints = Array.isArray(data.endpoints) ? data.endpoints : [];
    const endpoint = endpoints.find((item) => Number(item.port) === Number(port) && item.url);
    if (endpoint?.url) {
      return ensureTrailingSlash(endpoint.url);
    }

    if (this.proxyBaseTemplate) {
      return ensureTrailingSlash(
        this.proxyBaseTemplate
          .replaceAll('{sandbox_id}', sandboxId)
          .replaceAll('{port}', String(port))
      );
    }

    throw new Error(`broker did not return proxy url for port ${port}`);
  }

  async waitForSandboxReady(data, sandboxId, proxyBaseUrl, { warmupFullBody = false } = {}) {
    const healthBaseUrl = tryResolveEndpointUrl(() =>
      this.resolveProxyBaseUrl(data, sandboxId, this.healthPort)
    );
    const result = {
      health: null,
      ui: null,
    };
    if (healthBaseUrl) {
      const healthUrl = new URL('health', healthBaseUrl).toString();
      this.log('info', 'broker.ready.health.start', {
        sandboxId,
        healthPort: this.healthPort,
      });
      result.health = await waitForHttpOk({
        url: healthUrl,
        fetchImpl: this.fetch,
        timeoutMs: this.readyTimeoutMs,
        pollMs: this.readyPollMs,
      });
      this.log('info', 'broker.ready.health.done', {
        sandboxId,
        healthPort: this.healthPort,
        durationMs: result.health.durationMs,
        attempts: result.health.attempts,
        statusCode: result.health.statusCode,
      });
    }

    this.log('info', 'broker.ready.ui.start', {
      sandboxId,
      uiPort: this.port,
    });
    result.ui = await waitForHttpOk({
      url: proxyBaseUrl,
      fetchImpl: this.fetch,
      timeoutMs: this.readyTimeoutMs,
      pollMs: this.readyPollMs,
      consumeBody: warmupFullBody,
    });
    this.log('info', 'broker.ready.ui.done', {
      sandboxId,
      uiPort: this.port,
      durationMs: result.ui.durationMs,
      attempts: result.ui.attempts,
      statusCode: result.ui.statusCode,
      bodyMs: result.ui.bodyMs ?? null,
      bodyBytes: result.ui.bodyBytes ?? null,
      consumeBody: warmupFullBody,
    });
    return result;
  }

  async request(path, init = {}) {
    if (!this.baseUrl) {
      throw new Error('SANDBOX_BROKER_URL is required');
    }
    if (!this.token) {
      throw new Error('SANDBOX_BROKER_TOKEN is required');
    }

    const method = init.method || 'GET';
    const startedAt = Date.now();
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });
    } catch (error) {
      const wrapped = new Error(
        `broker fetch failed: ${method} ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      wrapped.code = 'BROKER_FETCH_FAILED';
      wrapped.cause = error;
      throw wrapped;
    }
    const bodyText = await response.text();
    this.log(response.ok ? 'info' : 'error', 'broker.request.done', {
      method,
      path,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
    });
    if (!response.ok) {
      const error = new Error(`broker request failed: ${response.status} ${bodyText}`);
      error.status = response.status;
      error.body = bodyText;
      throw error;
    }
    if (response.status === 204 || !bodyText) {
      return {};
    }
    return JSON.parse(bodyText);
  }
}

async function waitForHttpOk({ url, fetchImpl, timeoutMs, pollMs, consumeBody = false }) {
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let attempts = 0;

  while (Date.now() <= deadline) {
    attempts += 1;
    try {
      const response = await fetchImpl(url, { redirect: 'manual' });
      if (response.ok || response.status === 302 || response.status === 307) {
        let bodyMs = null;
        let bodyBytes = null;
        if (consumeBody && response.body) {
          const bodyStartedAt = Date.now();
          const buffer = await response.arrayBuffer();
          bodyMs = Date.now() - bodyStartedAt;
          bodyBytes = buffer.byteLength;
        }
        return {
          attempts,
          durationMs: Date.now() - startedAt,
          statusCode: response.status,
          bodyMs,
          bodyBytes,
        };
      }
      lastError = new Error(`ready check ${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(pollMs);
  }

  throw lastError || new Error(`timed out waiting for ${url}`);
}

function tryResolveEndpointUrl(fn) {
  try {
    return fn();
  } catch {
    return '';
  }
}

function ensureTrailingSlash(value) {
  return String(value).endsWith('/') ? String(value) : `${value}/`;
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
