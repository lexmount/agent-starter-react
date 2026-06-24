export function readSandboxGatewayConfig(env = process.env) {
  return {
    port: readInt(env.PORT || env.LIVEAVATAR_GATEWAY_PORT, 18090),
    provider: readString(env.LIVEAVATAR_PROVIDER, 'sandbox').toLowerCase(),
    inviteCode: readString(env.LIVEAVATAR_INVITE_CODE),
    tokenTtlMs: readInt(env.LIVEAVATAR_TOKEN_TTL_SECONDS, 3600) * 1000,
    sandboxTtlSeconds: readInt(env.SANDBOX_TTL_SECONDS, 3600),
    maxActiveSessions: readInt(env.LIVEAVATAR_MAX_ACTIVE_SESSIONS, 5),
    warmPoolSize: readNonNegativeInt(env.LIVEAVATAR_WARM_POOL_SIZE, 0),
    warmPoolRefillIntervalMs: readInt(env.LIVEAVATAR_WARM_POOL_REFILL_INTERVAL_SECONDS, 10) * 1000,
    warmPoolMaxIdleSeconds: readInt(env.LIVEAVATAR_WARM_POOL_MAX_IDLE_SECONDS, 300),
    warmPoolWarmupFullBody: readBoolean(env.LIVEAVATAR_WARM_POOL_WARMUP_FULL_BODY, true),
    stateFile: readString(env.LIVEAVATAR_STATE_FILE, './.sandbox-gateway/sessions.json'),
    gatewayAuth: readString(env.LIVEAVATAR_GATEWAY_AUTH, 'none').toLowerCase(),
    signatureClients: readString(env.LIVEAVATAR_SIGNATURE_CLIENTS),
    signatureMaxSkewMs: readInt(env.LIVEAVATAR_SIGNATURE_MAX_SKEW_SECONDS, 300) * 1000,
    signatureNonceTtlMs: readInt(env.LIVEAVATAR_SIGNATURE_NONCE_TTL_SECONDS, 300) * 1000,
    brokerUrl: readString(env.SANDBOX_BROKER_URL),
    brokerToken: readString(env.SANDBOX_BROKER_TOKEN),
    sandboxTemplateId: readString(env.SANDBOX_TEMPLATE_ID),
    sandboxTenantId: readString(env.SANDBOX_TENANT_ID, 'lexmount'),
    sandboxPort: readInt(env.SANDBOX_UI_PORT, 4003),
    sandboxHealthPort: readInt(env.SANDBOX_HEALTH_PORT, 49999),
    sandboxExtraPorts: readPortList(env.SANDBOX_EXTRA_PORTS),
    sandboxReadyTimeoutMs: readInt(env.SANDBOX_READY_TIMEOUT_SECONDS, 90) * 1000,
    sandboxReadyPollMs: readInt(env.SANDBOX_READY_POLL_MS, 1000),
    sandboxProxyBaseTemplate: readString(
      env.SANDBOX_PROXY_BASE_TEMPLATE,
      'https://sandbox.local.lexmount.net/api/v1/sandboxes/{sandbox_id}/proxy/{port}/'
    ),
    sandboxEnv: readPrefixedEnv(env, 'SANDBOX_ENV_'),
    localProxyBaseUrl: readString(env.LIVEAVATAR_LOCAL_PROXY_BASE_URL, 'http://127.0.0.1:4003/'),
    localReadyTimeoutMs: readInt(env.LIVEAVATAR_LOCAL_READY_TIMEOUT_SECONDS, 10) * 1000,
    localReadyPollMs: readInt(env.LIVEAVATAR_LOCAL_READY_POLL_MS, 500),
    appConfigAgentName: readString(env.LIVEAVATAR_AGENT_NAME),
  };
}

function readString(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function readInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readBoolean(value, fallback) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function readPortList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((port) => Number.isFinite(port) && port > 0);
}

function readPrefixedEnv(env, prefix) {
  const values = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    const targetKey = key.slice(prefix.length);
    if (!targetKey || value == null || String(value).trim() === '') {
      continue;
    }
    values[targetKey] = String(value);
  }
  return values;
}
