import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { EndpointConnectivityPayload } from './endpoint-connectivity';

const LEASE_TTL_MS = 45_000;
const REGISTRY_LOCK_FILE = '.generic-endpoint-lease.lock';
const REGISTRY_LOCK_TIMEOUT_MS = 3_000;
const REGISTRY_STALE_LOCK_MS = 10_000;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const INSTANCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEASE_FILE_PATTERN = /^([0-9a-f-]{36})\.lease\.json$/i;
const RECORD_FIELDS = ['address', 'deviceId', 'expiresAt', 'instanceId', 'receivedAt'] as const;

type Environment = Record<string, string | undefined>;
type ClockDependencies = { now?: () => Date };

type Cidr = { network: number; prefix: number; source: string };

export type GenericEndpointLeaseConfig = {
  deviceId: string;
  allowedCidrs: readonly Cidr[];
  registryDir: string;
};

export type GenericEndpointLease = {
  deviceId: string;
  instanceId: string;
  address: string;
  receivedAt: string;
  expiresAt: string;
};

export class EndpointLeaseUnavailableError extends Error {
  constructor(message = 'Generic endpoint lease is unavailable') {
    super(message);
    this.name = 'EndpointLeaseUnavailableError';
  }
}

export class EndpointLeaseConflictError extends Error {
  constructor(message = 'Generic endpoint lease has multiple active instances') {
    super(message);
    this.name = 'EndpointLeaseConflictError';
  }
}

export function loadGenericEndpointLeaseConfig(
  environment: Environment = process.env
): GenericEndpointLeaseConfig {
  const deviceId = readEnv(environment, 'GENERIC_EDGE_MEDIA_DEVICE_ID');
  const cidrText = readEnv(environment, 'GENERIC_EDGE_MEDIA_ALLOWED_CIDRS');
  const registryDir = readEnv(environment, 'GENERIC_ENDPOINT_REGISTRY_DIR');
  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    throw new Error('GENERIC_EDGE_MEDIA_DEVICE_ID is required');
  }
  if (!cidrText) {
    throw new Error('GENERIC_EDGE_MEDIA_ALLOWED_CIDRS is required');
  }
  if (!path.isAbsolute(registryDir)) {
    throw new Error('GENERIC_ENDPOINT_REGISTRY_DIR must be absolute');
  }
  if (readEnv(environment, 'GENERIC_ENDPOINT_MULTI_HOST') === '1') {
    throw new Error('Generic endpoint lease does not support multi-host Next deployments');
  }
  return {
    deviceId,
    allowedCidrs: cidrText.split(',').map((item) => parseAllowedCidr(item.trim())),
    registryDir: path.resolve(registryDir),
  };
}

export async function renewGenericEndpointLease(
  heartbeat: EndpointConnectivityPayload,
  config: GenericEndpointLeaseConfig,
  dependencies: ClockDependencies = {}
): Promise<GenericEndpointLease> {
  if (heartbeat.deviceId !== config.deviceId) {
    throw new Error('heartbeat deviceId does not match configured device');
  }
  const instanceId = normalizeInstanceId(heartbeat.instanceId);
  const address = validateAllowedAddress(heartbeat.address, config.allowedCidrs);
  await ensureSecureRegistryDirectory(config.registryDir);
  return withRegistryLock(config.registryDir, async () => {
    const now = (dependencies.now ?? (() => new Date()))();
    const records = await readLeaseRecords(config, now, true);
    if (records.some((record) => record.instanceId !== instanceId)) {
      throw new EndpointLeaseConflictError();
    }
    const record: GenericEndpointLease = {
      deviceId: config.deviceId,
      instanceId,
      address,
      receivedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
    };
    await writeLeaseAtomically(config.registryDir, record);
    return record;
  });
}

export async function resolveActiveGenericEndpointLease(
  config: GenericEndpointLeaseConfig,
  dependencies: ClockDependencies = {}
): Promise<GenericEndpointLease> {
  await ensureSecureRegistryDirectory(config.registryDir);
  return withRegistryLock(config.registryDir, async () => {
    const records = await readLeaseRecords(
      config,
      (dependencies.now ?? (() => new Date()))(),
      true
    );
    if (records.length === 0) {
      throw new EndpointLeaseUnavailableError();
    }
    if (records.length !== 1) {
      throw new EndpointLeaseConflictError();
    }
    return Object.freeze({ ...records[0] });
  });
}

export function buildGenericEdgeControlUrl(
  lease: Pick<GenericEndpointLease, 'address'>,
  action: 'start' | 'stop'
): string {
  const address = validateCanonicalPrivateIpv4(lease.address);
  return `http://${address}:8013/${action}`;
}

async function ensureSecureRegistryDirectory(directory: string): Promise<void> {
  try {
    const info = await lstat(directory);
    validateRegistryDirectory(info, directory);
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) {
      throw error;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    validateRegistryDirectory(await lstat(directory), directory);
  }
}

function validateRegistryDirectory(info: Awaited<ReturnType<typeof lstat>>, directory: string) {
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('Generic endpoint registry directory must be a real directory');
  }
  if ((Number(info.mode) & 0o777) !== 0o700) {
    throw new Error('Generic endpoint registry directory must use mode 0700');
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error(`Generic endpoint registry directory has the wrong owner: ${directory}`);
  }
}

async function readLeaseRecords(
  config: GenericEndpointLeaseConfig,
  now: Date,
  cleanExpired: boolean
): Promise<GenericEndpointLease[]> {
  const records: GenericEndpointLease[] = [];
  for (const entry of await readdir(config.registryDir)) {
    const match = LEASE_FILE_PATTERN.exec(entry);
    if (!match) {
      continue;
    }
    const filePath = path.join(config.registryDir, entry);
    const info = await lstat(filePath);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error('Generic endpoint lease record must be a regular file');
    }
    if ((info.mode & 0o777) !== 0o600) {
      throw new Error('Generic endpoint lease record must use mode 0600');
    }
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
      throw new Error('Generic endpoint lease record has the wrong owner');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8'));
    } catch {
      throw new Error('Generic endpoint lease record is invalid');
    }
    const record = validateLeaseRecord(parsed, config);
    if (record.instanceId !== match[1].toLowerCase()) {
      throw new Error('Generic endpoint lease record identity mismatch');
    }
    if (Date.parse(record.expiresAt) <= now.getTime()) {
      if (cleanExpired) {
        await unlink(filePath);
      }
      continue;
    }
    records.push(record);
  }
  return records;
}

function validateLeaseRecord(value: unknown, config: GenericEndpointLeaseConfig) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Generic endpoint lease record is invalid');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== [...RECORD_FIELDS].sort().join(',')) {
    throw new Error('Generic endpoint lease record fields are invalid');
  }
  if (record.deviceId !== config.deviceId) {
    throw new Error('Generic endpoint lease record device is invalid');
  }
  const instanceId = normalizeInstanceId(record.instanceId);
  const address = validateAllowedAddress(record.address, config.allowedCidrs);
  const receivedAt = validateTimestamp(record.receivedAt, 'receivedAt');
  const expiresAt = validateTimestamp(record.expiresAt, 'expiresAt');
  return { deviceId: config.deviceId, instanceId, address, receivedAt, expiresAt };
}

async function writeLeaseAtomically(directory: string, record: GenericEndpointLease) {
  const destination = path.join(directory, `${record.instanceId}.lease.json`);
  const temporary = path.join(directory, `.${record.instanceId}.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(record));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, destination);
    await chmod(destination, 0o600);
  } catch (error) {
    await unlink(temporary).catch((unlinkError) => {
      if (!isNodeError(unlinkError, 'ENOENT')) throw unlinkError;
    });
    throw error;
  }
}

async function withRegistryLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = path.join(directory, REGISTRY_LOCK_FILE);
  const deadline = Date.now() + REGISTRY_LOCK_TIMEOUT_MS;
  while (true) {
    let acquired = false;
    try {
      const file = await open(lockPath, 'wx', 0o600);
      acquired = true;
      try {
        await file.writeFile(`${process.pid}\n`);
        await file.sync();
      } finally {
        await file.close();
      }
      break;
    } catch (error) {
      if (acquired) {
        await unlink(lockPath).catch((unlinkError) => {
          if (!isNodeError(unlinkError, 'ENOENT')) throw unlinkError;
        });
      }
      if (!isNodeError(error, 'EEXIST')) throw error;
      await clearDeadRegistryLock(lockPath);
      if (Date.now() >= deadline) {
        throw new Error('Generic endpoint lease registry is busy');
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  try {
    return await operation();
  } finally {
    await unlink(lockPath).catch((error) => {
      if (!isNodeError(error, 'ENOENT')) throw error;
    });
  }
}

async function clearDeadRegistryLock(lockPath: string): Promise<void> {
  try {
    const info = await lstat(lockPath);
    if (info.isSymbolicLink() || !info.isFile() || (Number(info.mode) & 0o777) !== 0o600) {
      throw new Error('Generic endpoint lease registry lock is unsafe');
    }
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
      throw new Error('Generic endpoint lease registry lock has the wrong owner');
    }

    const owner = Number.parseInt((await readFile(lockPath, 'utf8')).trim(), 10);
    let ownerAlive = Number.isInteger(owner) && owner > 0;
    if (ownerAlive) {
      try {
        process.kill(owner, 0);
      } catch (error) {
        if (!isNodeError(error, 'ESRCH')) throw error;
        ownerAlive = false;
      }
    }
    if (!ownerAlive && Date.now() - info.mtimeMs >= REGISTRY_STALE_LOCK_MS) {
      await unlink(lockPath).catch((error) => {
        if (!isNodeError(error, 'ENOENT')) throw error;
      });
    }
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error;
  }
}

function parseAllowedCidr(value: string): Cidr {
  const [address, prefixText, ...extra] = value.split('/');
  const prefix = Number(prefixText);
  if (extra.length > 0 || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error('GENERIC_EDGE_MEDIA_ALLOWED_CIDRS contains an invalid IPv4 CIDR');
  }
  const canonical = validateCanonicalPrivateIpv4(address);
  const numeric = ipv4ToInt(canonical);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  if ((numeric & mask) >>> 0 !== numeric) {
    throw new Error('GENERIC_EDGE_MEDIA_ALLOWED_CIDRS must use canonical network addresses');
  }
  return { network: numeric, prefix, source: value };
}

function validateAllowedAddress(value: unknown, cidrs: readonly Cidr[]): string {
  const address = validateCanonicalPrivateIpv4(value);
  const numeric = ipv4ToInt(address);
  const allowed = cidrs.some(({ network, prefix }) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (numeric & mask) >>> 0 === network;
  });
  if (!allowed) {
    throw new Error('heartbeat address is outside the allowed CIDR policy');
  }
  return address;
}

function validateCanonicalPrivateIpv4(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    throw new Error('heartbeat address must be canonical private IPv4');
  }
  const octets = value.split('.');
  if (octets.some((part) => String(Number(part)) !== part || Number(part) > 255)) {
    throw new Error('heartbeat address must be canonical private IPv4');
  }
  const [first, second] = octets.map(Number);
  const isPrivate =
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
  if (!isPrivate) {
    throw new Error('heartbeat address must be RFC1918 private IPv4');
  }
  return value;
}

function ipv4ToInt(address: string): number {
  return address
    .split('.')
    .map(Number)
    .reduce((value, octet) => ((value << 8) | octet) >>> 0, 0);
}

function normalizeInstanceId(value: unknown): string {
  if (typeof value !== 'string' || !INSTANCE_ID_PATTERN.test(value)) {
    throw new Error('heartbeat instanceId must be an RFC 4122 version 4 UUID');
  }
  return value.toLowerCase();
}

function validateTimestamp(value: unknown, name: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Generic endpoint lease record ${name} is invalid`);
  }
  return value;
}

function readEnv(environment: Environment, name: string): string {
  return environment[name]?.trim() ?? '';
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
