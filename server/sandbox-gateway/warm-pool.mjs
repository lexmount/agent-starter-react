import crypto from 'node:crypto';

export class WarmSandboxPool {
  constructor({
    broker,
    targetSize = 0,
    maxActiveSessions = 5,
    sandboxTtlSeconds = 3600,
    maxIdleSeconds = 300,
    warmupFullBody = true,
    maxMaintainCreateFailures = 3,
    now = () => Date.now(),
    randomId = () => crypto.randomBytes(8).toString('base64url'),
    logger = () => undefined,
  }) {
    this.broker = broker;
    this.targetSize = Math.max(0, Number(targetSize) || 0);
    this.maxActiveSessions = Math.max(0, Number(maxActiveSessions) || 0);
    this.sandboxTtlSeconds = Math.max(1, Number(sandboxTtlSeconds) || 3600);
    this.maxIdleMs = Math.max(1, Number(maxIdleSeconds) || 300) * 1000;
    this.refreshLeadMs = Math.min(60_000, Math.floor(this.maxIdleMs / 2));
    this.warmupFullBody = Boolean(warmupFullBody);
    this.maxMaintainCreateFailures = Math.max(1, Number(maxMaintainCreateFailures) || 3);
    this.now = now;
    this.randomId = randomId;
    this.logger = logger;
    this.items = [];
    this.maintaining = null;
    this.stopped = false;
  }

  stats({ activeCount = 0 } = {}) {
    const now = this.now();
    const target = this.targetFor({ activeCount });
    return {
      enabled: this.targetSize > 0,
      target_size: target,
      configured_size: this.targetSize,
      ready: this.readyItems().length,
      warming: this.items.filter((item) => item.status === 'warming' && item.expiresAt > now)
        .length,
      max_idle_seconds: Math.round(this.maxIdleMs / 1000),
      refresh_lead_seconds: Math.round(this.refreshLeadMs / 1000),
      warmup_full_body: this.warmupFullBody,
    };
  }

  async maintain({ activeCount = 0, trigger = 'manual' } = {}) {
    if (this.stopped || this.targetSize <= 0) {
      return;
    }
    if (this.maintaining) {
      this.log('info', 'warm_pool.maintain.skip_busy', { trigger });
      return this.maintaining;
    }

    this.maintaining = this.doMaintain({ activeCount, trigger }).finally(() => {
      this.maintaining = null;
    });
    return this.maintaining;
  }

  async doMaintain({ activeCount, trigger }) {
    const startedAt = this.now();
    await this.dropExpiredItems({ release: true });
    const target = this.targetFor({ activeCount });
    await this.releaseExtraReadyItems({ target });

    let createFailures = 0;
    while (!this.stopped && this.poolFootprint() < target) {
      const created = await this.createWarmSandbox({ trigger });
      if (created) {
        createFailures = 0;
        continue;
      }

      createFailures += 1;
      if (createFailures >= this.maxMaintainCreateFailures) {
        this.log('error', 'warm_pool.maintain.create_limit_reached', {
          trigger,
          failures: createFailures,
          target,
          footprint: this.poolFootprint(),
        });
        break;
      }
    }
    await this.releaseExtraReadyItems({ target });

    this.log('info', 'warm_pool.maintain.done', {
      trigger,
      durationMs: this.now() - startedAt,
      ...this.stats({ activeCount }),
    });
  }

  async checkout() {
    await this.dropExpiredItems({ release: true });
    const ready = this.readyItems();
    if (ready.length === 0) {
      this.log('info', 'warm_pool.checkout.miss', this.stats());
      return null;
    }

    const item = ready[0];
    this.items = this.items.filter((candidate) => candidate !== item);
    this.log('info', 'warm_pool.checkout.hit', {
      poolId: item.poolId,
      sandboxId: item.sandboxId,
      warmedMs: this.now() - item.readyAt,
      idleMs: this.now() - item.createdAt,
      ready: this.readyItems().length,
      warming: this.items.filter((candidate) => candidate.status === 'warming').length,
    });
    return {
      sandboxId: item.sandboxId,
      proxyBaseUrl: item.proxyBaseUrl,
      allocationSource: 'warm_pool',
      poolId: item.poolId,
      warmedMs: this.now() - item.readyAt,
    };
  }

  async stop({ releaseIdle = true } = {}) {
    this.stopped = true;
    if (!releaseIdle) {
      this.items = [];
      return;
    }

    const items = this.items;
    this.items = [];
    await Promise.allSettled(
      items
        .filter((item) => item.sandboxId)
        .map((item) => this.releaseItem(item, { reason: 'stop' }))
    );
  }

  targetFor({ activeCount = 0 } = {}) {
    const remainingCapacity = Math.max(0, this.maxActiveSessions - Number(activeCount || 0));
    return Math.min(this.targetSize, remainingCapacity);
  }

  readyItems() {
    const now = this.now();
    return this.items.filter((item) => item.status === 'ready' && item.expiresAt > now);
  }

  poolFootprint() {
    const now = this.now();
    return this.items.filter(
      (item) =>
        item.status === 'warming' ||
        (item.status === 'ready' && item.expiresAt - now > this.refreshLeadMs)
    ).length;
  }

  async createWarmSandbox({ trigger }) {
    const poolId = `lv_pool_${this.randomId()}`;
    const item = {
      poolId,
      status: 'warming',
      createdAt: this.now(),
      readyAt: 0,
      expiresAt: this.now() + this.maxIdleMs,
      sandboxId: '',
      proxyBaseUrl: '',
    };
    this.items.push(item);

    const ttlSeconds = this.sandboxTtlSeconds + Math.ceil(this.maxIdleMs / 1000);
    this.log('info', 'warm_pool.create.start', {
      trigger,
      poolId,
      ttlSeconds,
      ready: this.readyItems().length,
      warming: this.items.filter((candidate) => candidate.status === 'warming').length,
      warmupFullBody: this.warmupFullBody,
    });

    const startedAt = this.now();
    try {
      const sandbox = await this.broker.createSandbox({
        sessionId: poolId,
        ttlSeconds,
        warmupFullBody: this.warmupFullBody,
      });
      item.status = 'ready';
      item.sandboxId = sandbox.sandboxId;
      item.proxyBaseUrl = sandbox.proxyBaseUrl;
      item.readyAt = this.now();
      this.log('info', 'warm_pool.create.done', {
        trigger,
        poolId,
        sandboxId: item.sandboxId,
        durationMs: this.now() - startedAt,
        expiresAt: new Date(item.expiresAt).toISOString(),
      });
      return true;
    } catch (error) {
      this.items = this.items.filter((candidate) => candidate !== item);
      this.log('error', 'warm_pool.create.failed', {
        trigger,
        poolId,
        durationMs: this.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async releaseExtraReadyItems({ target }) {
    const ready = this.readyItems().sort((left, right) => left.expiresAt - right.expiresAt);
    const extraCount = Math.max(0, ready.length - target);
    if (extraCount === 0) {
      return;
    }

    const extra = ready.slice(0, extraCount);
    this.items = this.items.filter((item) => !extra.includes(item));
    for (const item of extra) {
      await this.releaseItem(item, { reason: 'over_target' });
    }
  }

  async dropExpiredItems({ release }) {
    const now = this.now();
    const expired = this.items.filter((item) => item.expiresAt <= now);
    if (expired.length === 0) {
      return;
    }

    this.items = this.items.filter((item) => !expired.includes(item));
    if (!release) {
      return;
    }

    for (const item of expired) {
      await this.releaseItem(item, { reason: 'idle_expired' });
    }
  }

  async releaseItem(item, { reason }) {
    if (!item.sandboxId) {
      return;
    }

    const startedAt = this.now();
    this.log('info', 'warm_pool.release.start', {
      reason,
      poolId: item.poolId,
      sandboxId: item.sandboxId,
    });
    try {
      await this.broker.releaseSandbox(item.sandboxId);
      this.log('info', 'warm_pool.release.done', {
        reason,
        poolId: item.poolId,
        sandboxId: item.sandboxId,
        durationMs: this.now() - startedAt,
      });
    } catch (error) {
      this.log('error', 'warm_pool.release.failed', {
        reason,
        poolId: item.poolId,
        sandboxId: item.sandboxId,
        durationMs: this.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log(level, event, details = {}) {
    try {
      this.logger(level, event, details);
    } catch {
      // Logging must never affect pool lifecycle operations.
    }
  }
}
