import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class GatewayError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'GatewayError';
    this.statusCode = statusCode;
  }
}

export class SessionStore {
  constructor({
    broker,
    inviteCode = '',
    maxActiveSessions = 5,
    now = () => Date.now(),
    randomId = () => crypto.randomBytes(8).toString('base64url'),
    randomToken = () => crypto.randomBytes(24).toString('base64url'),
    tokenTtlMs = 3_600_000,
    sandboxTtlSeconds = 3_600,
    stateFile = '',
    warmPool = null,
  }) {
    this.broker = broker;
    this.warmPool = warmPool;
    this.inviteCode = inviteCode;
    this.maxActiveSessions = maxActiveSessions;
    this.now = now;
    this.randomId = randomId;
    this.randomToken = randomToken;
    this.tokenTtlMs = tokenTtlMs;
    this.sandboxTtlSeconds = sandboxTtlSeconds;
    this.stateFile = stateFile;
    this.sessions = [];
    this.acquireQueue = Promise.resolve();
    this.load();
  }

  load() {
    if (!this.stateFile || !fs.existsSync(this.stateFile)) {
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    this.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
  }

  save() {
    if (!this.stateFile) {
      return;
    }

    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const tmpFile = `${this.stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFile, `${JSON.stringify({ sessions: this.sessions }, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(tmpFile, this.stateFile);
  }

  async acquire({ ip, invite = '' }) {
    const next = this.acquireQueue.then(() => this.acquireLocked({ ip, invite }));
    this.acquireQueue = next.catch(() => undefined);
    return next;
  }

  async acquireLocked({ ip, invite = '' }) {
    this.assertInvite(invite);
    this.expireOldSessions();

    if (this.activeSessions().length >= this.maxActiveSessions) {
      throw new GatewayError('active session limit reached', 429);
    }

    const slug = this.uniqueSlug();
    const token = this.randomToken();
    const sessionId = `lv_${slug}`;
    let sandbox = await this.warmPool?.checkout();
    let allocationSource = sandbox?.allocationSource || 'warm_pool';
    if (!sandbox) {
      allocationSource = 'on_demand';
      sandbox = await this.broker.createSandbox({
        sessionId,
        ttlSeconds: this.sandboxTtlSeconds,
      });
    }
    const now = this.now();
    const session = {
      sessionId,
      slug,
      token,
      ip,
      invite,
      sandboxId: sandbox.sandboxId,
      proxyBaseUrl: sandbox.proxyBaseUrl,
      allocationSource,
      status: 'active',
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + this.tokenTtlMs,
      releasedAt: null,
    };
    this.sessions.push(session);
    try {
      this.save();
    } catch (error) {
      this.sessions = this.sessions.filter((candidate) => candidate !== session);
      try {
        await this.releaseAllocatedSandbox(sandbox);
      } catch (releaseError) {
        if (error instanceof Error) {
          error.releaseError = releaseError;
        }
      }
      throw error;
    }
    return { ...session, reused: false };
  }

  async releaseAllocatedSandbox(sandbox) {
    if (!sandbox?.sandboxId) {
      return;
    }
    await this.broker.releaseSandbox(sandbox.sandboxId);
  }

  warmPoolStats() {
    if (!this.warmPool) {
      return {
        enabled: false,
        target_size: 0,
        configured_size: 0,
        ready: 0,
        warming: 0,
      };
    }
    return this.warmPool.stats({ activeCount: this.activeSessions().length });
  }

  requireSession({ slug, token = '' }) {
    this.expireOldSessions();
    const session = this.sessions.find((candidate) => candidate.slug === slug);
    if (!session || session.status !== 'active') {
      throw new GatewayError('session not found', 404);
    }
    if (session.expiresAt <= this.now()) {
      session.status = 'expired';
      this.save();
      throw new GatewayError('session expired', 401);
    }
    if (token && !safeEqual(token, session.token)) {
      throw new GatewayError('invalid token', 401);
    }
    if (!token) {
      throw new GatewayError('token required', 401);
    }

    session.lastUsedAt = this.now();
    this.save();
    return { ...session };
  }

  getActiveBySlug(slug) {
    this.expireOldSessions();
    const session = this.sessions.find(
      (candidate) =>
        candidate.slug === slug && candidate.status === 'active' && candidate.expiresAt > this.now()
    );
    return session ? { ...session } : null;
  }

  async release({ slug, token = '' }) {
    const session = this.requireSession({ slug, token });
    const stored = this.sessions.find((candidate) => candidate.slug === slug);
    await this.broker.releaseSandbox(session.sandboxId);
    stored.status = 'released';
    stored.releasedAt = this.now();
    this.save();
    return { ...stored };
  }

  async releaseExpired() {
    this.expireOldSessions();
    const expired = this.sessions.filter(
      (session) => session.status === 'expired' && session.sandboxId && !session.releasedAt
    );
    for (const session of expired) {
      await this.broker.releaseSandbox(session.sandboxId);
      session.releasedAt = this.now();
      this.save();
    }
    return expired.length;
  }

  activeSessions() {
    return this.sessions.filter(
      (session) => session.status === 'active' && session.expiresAt > this.now()
    );
  }

  assertInvite(invite) {
    if (this.inviteCode && invite !== this.inviteCode) {
      throw new GatewayError('invalid invite', 401);
    }
  }

  expireOldSessions() {
    let changed = false;
    for (const session of this.sessions) {
      if (session.status === 'active' && session.expiresAt <= this.now()) {
        session.status = 'expired';
        changed = true;
      }
    }
    if (changed) {
      this.save();
    }
  }

  uniqueSlug() {
    for (let attempts = 0; attempts < 10; attempts += 1) {
      const slug = this.randomId();
      if (!this.sessions.some((session) => session.slug === slug)) {
        return slug;
      }
    }
    throw new GatewayError('failed to allocate unique session slug', 500);
  }
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
