import http from 'node:http';
import { once } from 'node:events';
import { URL } from 'node:url';
import { BrokerClient } from './broker-client.mjs';
import { readSandboxGatewayConfig } from './config.mjs';
import { LocalTargetClient } from './local-target-client.mjs';
import { GatewayError, SessionStore } from './session-store.mjs';
import { SignatureAuthenticator } from './signature-auth.mjs';
import { WarmSandboxPool } from './warm-pool.mjs';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const FETCH_BODY_METADATA_HEADERS = new Set(['content-encoding', 'content-length', 'etag']);
const BROWSER_INPUT_SOURCE = 'browser';

export function createServer({ config, store, signatureAuth = null, refillWarmPool = () => {} }) {
  return http.createServer(async (req, res) => {
    try {
      await routeRequest({ req, res, config, store, signatureAuth, refillWarmPool });
    } catch (error) {
      logGateway('error', 'request.failed', {
        method: req.method || 'GET',
        path: redactedRequestPath(req),
        statusCode: error instanceof GatewayError ? error.statusCode : 500,
        message: error instanceof Error ? error.message : String(error),
      });
      sendError(res, error);
    }
  });
}

export async function routeRequest({
  req,
  res,
  config,
  store,
  signatureAuth = null,
  refillWarmPool = () => {},
}) {
  const url = new URL(req.url || '/', 'http://gateway.local');
  const ip = clientIp(req);
  const activeSessions = store.activeSessions();

  if (url.pathname === '/_healthz') {
    sendJson(res, 200, {
      status: 'ok',
      active: activeSessions.length,
      max_active: config.maxActiveSessions,
      warm_pool:
        typeof store.warmPoolStats === 'function'
          ? store.warmPoolStats()
          : {
              enabled: false,
              target_size: 0,
              configured_size: 0,
              ready: 0,
              warming: 0,
            },
    });
    return;
  }

  if (url.pathname === '/__gateway/app-config') {
    if (req.method !== 'GET') {
      throw new GatewayError('method not allowed', 405);
    }
    sendJson(res, 200, sandboxAppConfigOverrides({ agentName: config.appConfigAgentName }));
    return;
  }

  if (url.pathname === '/__gateway/sessions') {
    if (req.method !== 'POST') {
      throw new GatewayError('method not allowed', 405);
    }
    const body = await readJsonBody(req);
    if (config.gatewayAuth === 'signature') {
      if (!signatureAuth) {
        throw new GatewayError('signature auth is not configured', 500);
      }
      const verified = signatureAuth.verify({
        headers: req.headers,
        method: req.method,
        path: url.pathname,
        body,
      });
      logGateway('info', 'signature.verify.done', { clientId: verified.clientId });
    }
    const session = await acquireSession({
      store,
      ip,
      invite: String(body.invite || ''),
      refillWarmPool,
    });
    sendJson(res, 200, {
      status: 'created',
      url: `/${session.slug}?token=${encodeURIComponent(session.token)}`,
      slug: session.slug,
      expires_at: new Date(session.expiresAt).toISOString(),
    });
    return;
  }

  if (url.pathname === '/') {
    if (config.gatewayAuth === 'signature') {
      throw new GatewayError('signed session creation required', 401);
    }
    const session = await acquireSession({
      store,
      ip,
      invite: url.searchParams.get('invite') || '',
      refillWarmPool,
    });
    redirect(res, `/${session.slug}?token=${encodeURIComponent(session.token)}`);
    return;
  }

  const slug = firstPathSegment(url.pathname);
  if (slug && url.pathname === `/${slug}/release`) {
    const session = resolveRequestSession({ req, url, store, ip, expectedSlug: slug });
    if (req.method !== 'POST') {
      sendReleasePage(res, session);
      return;
    }
    logGateway('info', 'session.release.start', { slug });
    const released = await store.release({
      slug,
      token: session.token,
      ip,
    });
    logGateway('info', 'session.release.done', {
      slug,
      sandboxId: released.sandboxId,
    });
    sendJson(res, 200, { status: 'released', sandbox_id: released.sandboxId, slug });
    return;
  }

  const active = resolveRequestSession({ req, url, store, ip });
  await proxyToSandbox({ req, res, url, session: active, config });
}

async function proxyToSandbox({ req, res, url, session, config }) {
  const startedAt = Date.now();
  const target = buildProxyTarget({
    pathname: url.pathname,
    search: url.search,
    slug: session.slug,
    proxyBaseUrl: session.proxyBaseUrl,
  });
  const headers = new Headers(req.headers);
  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }
  headers.delete('host');
  headers.set('x-sandbox-id', session.sandboxId);
  headers.set('x-liveavatar-session-slug', session.slug);
  headers.set('x-liveavatar-session-id', session.sessionId);

  const init = {
    method: req.method,
    headers,
    redirect: 'manual',
  };
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    init.body = req;
    init.duplex = 'half';
  }

  const response = await fetch(target, init);
  if (shouldRewriteSandboxAppConfig(response)) {
    const body = await response.text();
    writeResponseHeaders(res, response, { fetchedBody: true });
    res.end(
      rewriteSandboxAppConfig(body, session, {
        agentName: config.appConfigAgentName,
      })
    );
    logGateway('info', 'proxy.request.done', {
      method: req.method || 'GET',
      path: url.pathname,
      slug: session.slug,
      sandboxId: session.sandboxId,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      rewritten: true,
    });
    return;
  }

  res.statusCode = response.status;
  if (!response.body) {
    writeResponseHeaders(res, response);
    res.end();
    logGateway('info', 'proxy.request.done', {
      method: req.method || 'GET',
      path: url.pathname,
      slug: session.slug,
      sandboxId: session.sandboxId,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      rewritten: false,
    });
    return;
  }
  writeResponseHeaders(res, response, { fetchedBody: true });
  await writeProxyResponseBody(res, response.body);
  logGateway('info', 'proxy.request.done', {
    method: req.method || 'GET',
    path: url.pathname,
    slug: session.slug,
    sandboxId: session.sandboxId,
    statusCode: response.status,
    durationMs: Date.now() - startedAt,
    rewritten: false,
  });
}

export async function writeProxyResponseBody(res, body) {
  for await (const chunk of body) {
    if (res.write(chunk)) {
      continue;
    }
    await once(res, 'drain');
  }
  res.end();
}

function writeResponseHeaders(res, response, { fetchedBody = false } = {}) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (shouldDropProxyResponseHeader(key, { fetchedBody })) {
      return;
    }
    res.setHeader(key, value);
  });
}

export function shouldDropProxyResponseHeader(headerName, { fetchedBody = false } = {}) {
  const normalized = String(headerName || '').toLowerCase();
  if (HOP_BY_HOP_HEADERS.has(normalized)) {
    return true;
  }
  return fetchedBody && FETCH_BODY_METADATA_HEADERS.has(normalized);
}

function shouldRewriteSandboxAppConfig(response) {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('text/html') || contentType.includes('text/x-component');
}

export function rewriteSandboxAppConfig(body, session, { agentName = '' } = {}) {
  const sandboxId = escapeJsonString(session.sandboxId);
  let rewritten = String(body)
    .replaceAll('\\"sandboxId\\":\\"$undefined\\"', `\\"sandboxId\\":\\"${sandboxId}\\"`)
    .replaceAll('"sandboxId":"$undefined"', `"sandboxId":"${sandboxId}"`)
    .replaceAll('\\"sandboxId\\":null', `\\"sandboxId\\":\\"${sandboxId}\\"`)
    .replaceAll('"sandboxId":null', `"sandboxId":"${sandboxId}"`);
  const normalizedAgentName = String(agentName || '').trim();
  if (!normalizedAgentName) {
    return rewritten;
  }

  const escapedAgentName = escapeJsonString(normalizedAgentName);
  rewritten = rewritten
    .replace(/\\"agentName\\":\\"[^"\\]*\\"/g, `\\"agentName\\":\\"${escapedAgentName}\\"`)
    .replace(/"agentName":"[^"]*"/g, `"agentName":"${escapedAgentName}"`);
  return rewritten;
}

export function buildProxyTarget({ pathname, search, slug, proxyBaseUrl }) {
  const targetPath = stripSessionPrefix(pathname, slug).replace(/^\/+/, '');
  const relativePath = targetPath || '';
  return new URL(`${relativePath}${gatewaySearchRemoved(search)}`, proxyBaseUrl).toString();
}

export function sandboxAppConfigOverrides({ agentName = '' } = {}) {
  const overrides = {
    inputSource: {
      type: 'string',
      value: BROWSER_INPUT_SOURCE,
    },
    audioInputDevice: {
      type: 'string',
      value: BROWSER_INPUT_SOURCE,
    },
    visionInputDevice: {
      type: 'string',
      value: BROWSER_INPUT_SOURCE,
    },
    outputDevice: {
      type: 'string',
      value: BROWSER_INPUT_SOURCE,
    },
    usesBrowserRawMediaInput: {
      type: 'boolean',
      value: true,
    },
    usesBrowserRawAudioInput: {
      type: 'boolean',
      value: true,
    },
    usesBrowserRawVideoInput: {
      type: 'boolean',
      value: true,
    },
    usesServerRoomInput: {
      type: 'boolean',
      value: false,
    },
    supportsScreenShare: {
      type: 'boolean',
      value: false,
    },
    showDefaultCameraPreview: {
      type: 'boolean',
      value: false,
    },
  };
  const normalizedAgentName = String(agentName || '').trim();
  if (normalizedAgentName) {
    overrides.agentName = {
      type: 'string',
      value: normalizedAgentName,
    };
  }
  return overrides;
}

export function startSandboxGateway(config = readSandboxGatewayConfig()) {
  const provider = createProvider(config);
  const signatureAuth = createSignatureAuth(config);
  const warmPool =
    config.warmPoolSize > 0
      ? new WarmSandboxPool({
          broker: provider,
          targetSize: config.warmPoolSize,
          maxActiveSessions: config.maxActiveSessions,
          sandboxTtlSeconds: config.sandboxTtlSeconds,
          maxIdleSeconds: config.warmPoolMaxIdleSeconds,
          warmupFullBody: config.warmPoolWarmupFullBody,
          logger: logGateway,
        })
      : null;
  const store = new SessionStore({
    broker: provider,
    warmPool,
    inviteCode: config.inviteCode,
    maxActiveSessions: config.maxActiveSessions,
    tokenTtlMs: config.tokenTtlMs,
    sandboxTtlSeconds: config.sandboxTtlSeconds,
    stateFile: config.stateFile,
    logger: logGateway,
  });
  const releaseInterval = setInterval(() => {
    store.releaseExpired().catch((error) => {
      logGateway('error', 'session.release_expired.failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, 60_000).unref();

  const refillWarmPool = (trigger = 'manual') => {
    if (!warmPool) {
      return;
    }
    warmPool
      .maintain({
        activeCount: store.activeSessions().length,
        trigger,
      })
      .catch((error) => {
        logGateway('error', 'warm_pool.maintain.failed', {
          trigger,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  const warmPoolInterval =
    warmPool && config.warmPoolRefillIntervalMs > 0
      ? setInterval(() => refillWarmPool('interval'), config.warmPoolRefillIntervalMs)
      : null;
  warmPoolInterval?.unref();

  const server = createServer({ config, store, signatureAuth, refillWarmPool });
  let cleanupPromise = null;
  const cleanupGateway = () => {
    cleanupPromise ??= (async () => {
      clearInterval(releaseInterval);
      if (warmPoolInterval) {
        clearInterval(warmPoolInterval);
      }
      if (warmPool) {
        await warmPool.stop({ releaseIdle: true });
      }
    })();
    return cleanupPromise;
  };
  server.on('close', () => {
    cleanupGateway().catch((error) => {
      logGateway('error', 'gateway.cleanup.failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });
  server.listen(config.port, '0.0.0.0', () => {
    logGateway('info', 'gateway.listen', {
      host: '0.0.0.0',
      port: config.port,
      provider: config.provider,
      gatewayAuth: config.gatewayAuth,
      maxActiveSessions: config.maxActiveSessions,
      warmPoolSize: config.warmPoolSize,
      warmPoolMaxIdleSeconds: config.warmPoolMaxIdleSeconds,
      warmPoolWarmupFullBody: config.warmPoolWarmupFullBody,
    });
    refillWarmPool('startup');
  });
  installShutdownHandlers(server, cleanupGateway);
  return server;
}

function installShutdownHandlers(server, cleanupGateway) {
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logGateway('info', 'gateway.shutdown.start', { signal });
    server.close(async (error) => {
      try {
        await cleanupGateway();
      } catch (cleanupError) {
        logGateway('error', 'gateway.cleanup.failed', {
          signal,
          message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
        process.exitCode = 1;
      }
      if (error) {
        logGateway('error', 'gateway.shutdown.failed', {
          signal,
          message: error instanceof Error ? error.message : String(error),
        });
        process.exitCode = 1;
      } else {
        logGateway('info', 'gateway.shutdown.done', { signal });
      }
      process.exit();
    });
    setTimeout(() => {
      logGateway('error', 'gateway.shutdown.timeout', { signal });
      process.exit(1);
    }, 10_000).unref();
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

function createSignatureAuth(config) {
  if (config.gatewayAuth === 'none') {
    return null;
  }
  if (config.gatewayAuth !== 'signature') {
    throw new Error(`unsupported LIVEAVATAR_GATEWAY_AUTH: ${config.gatewayAuth}`);
  }
  return new SignatureAuthenticator({
    clients: config.signatureClients,
    maxSkewMs: config.signatureMaxSkewMs,
    nonceTtlMs: config.signatureNonceTtlMs,
  });
}

function createProvider(config) {
  if (config.provider === 'local') {
    return new LocalTargetClient({
      proxyBaseUrl: config.localProxyBaseUrl,
      readyTimeoutMs: config.localReadyTimeoutMs,
      readyPollMs: config.localReadyPollMs,
    });
  }

  if (config.provider !== 'sandbox') {
    throw new Error(`unsupported LIVEAVATAR_PROVIDER: ${config.provider}`);
  }

  return new BrokerClient({
    baseUrl: config.brokerUrl,
    token: config.brokerToken,
    templateId: config.sandboxTemplateId,
    tenantId: config.sandboxTenantId,
    port: config.sandboxPort,
    healthPort: config.sandboxHealthPort,
    extraPorts: config.sandboxExtraPorts,
    readyTimeoutMs: config.sandboxReadyTimeoutMs,
    readyPollMs: config.sandboxReadyPollMs,
    proxyBaseTemplate: config.sandboxProxyBaseTemplate,
    env: config.sandboxEnv,
    logger: logGateway,
  });
}

function stripSessionPrefix(pathname, slug) {
  if (pathname === `/${slug}` || pathname === `/${slug}/`) {
    return '/';
  }
  if (pathname.startsWith(`/${slug}/`)) {
    return pathname.slice(slug.length + 1) || '/';
  }
  return pathname;
}

function firstPathSegment(pathname) {
  return (
    String(pathname || '')
      .split('/')
      .filter(Boolean)[0] || ''
  );
}

function clientIp(req) {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return forwardedFor || req.socket.remoteAddress || 'unknown';
}

async function acquireSession({ store, ip, invite = '', refillWarmPool = () => {} }) {
  const startedAt = Date.now();
  logGateway('info', 'session.acquire.start', {
    inviteProvided: Boolean(invite),
  });
  try {
    const session = await store.acquire({ ip, invite });
    logGateway('info', 'session.acquire.done', {
      slug: session.slug,
      sandboxId: session.sandboxId,
      allocationSource: session.allocationSource,
      expiresAt: new Date(session.expiresAt).toISOString(),
      durationMs: Date.now() - startedAt,
    });
    refillWarmPool('post_acquire');
    return session;
  } catch (error) {
    logGateway('error', 'session.acquire.failed', {
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function readJsonBody(req) {
  const raw = await readRequestBody(req, 16 * 1024);
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new GatewayError('invalid json body', 400);
  }
}

async function readRequestBody(req, limitBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) {
      throw new GatewayError('request body too large', 413);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function redactedRequestPath(req) {
  try {
    return new URL(req.url || '/', 'http://gateway.local').pathname;
  } catch {
    return '/';
  }
}

function logGateway(level, event, details = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    component: 'liveavatar-sandbox-gateway',
    event,
    ...details,
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  console.log(line);
}

function resolveRequestSession({ req, url, store, ip, expectedSlug = '' }) {
  const current = sessionCandidateFromUrl(url);
  if (current) {
    if (expectedSlug && current.slug !== expectedSlug) {
      throw new GatewayError('session slug mismatch', 401);
    }
    return store.requireSession({ ...current, ip });
  }

  const fromReferer = sessionCandidateFromReferer(req);
  if (fromReferer) {
    if (expectedSlug && fromReferer.slug !== expectedSlug) {
      throw new GatewayError('session slug mismatch', 401);
    }
    return store.requireSession({ ...fromReferer, ip });
  }

  throw new GatewayError('token required', 401);
}

function sessionCandidateFromUrl(url) {
  const slug = firstPathSegment(url.pathname);
  const token = url.searchParams.get('token') || '';
  return slug && token ? { slug, token } : null;
}

function sessionCandidateFromReferer(req) {
  const raw = String(req.headers.referer || req.headers.referrer || '').trim();
  if (!raw) {
    return null;
  }

  let refererUrl;
  try {
    refererUrl = new URL(raw, `http://${req.headers.host || 'gateway.local'}`);
  } catch {
    return null;
  }

  const host = String(req.headers.host || '').trim();
  if (host && refererUrl.host !== host) {
    return null;
  }
  return sessionCandidateFromUrl(refererUrl);
}

function gatewaySearchRemoved(search) {
  const searchParams = new URLSearchParams(search || '');
  searchParams.delete('token');
  const targetSearch = searchParams.toString();
  return targetSearch ? `?${targetSearch}` : '';
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(payload)}\n`);
}

function sendReleasePage(res, session) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const action = `/${encodeURIComponent(session.slug)}/release?token=${encodeURIComponent(session.token)}`;
  res.end(`<!doctype html>
<form method="post" action="${escapeHtml(action)}">
  <button type="submit">Release sandbox</button>
</form>`);
}

function sendError(res, error) {
  const statusCode = error instanceof GatewayError ? error.statusCode : 500;
  sendJson(res, statusCode, {
    status: 'error',
    error: error instanceof Error ? error.message : String(error),
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeJsonString(value) {
  return JSON.stringify(String(value)).slice(1, -1).replaceAll('<', '\\u003c');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startSandboxGateway();
}
