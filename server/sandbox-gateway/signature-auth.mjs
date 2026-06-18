import crypto from 'node:crypto';
import { GatewayError } from './session-store.mjs';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export class SignatureAuthenticator {
  constructor({
    clients = '',
    maxSkewMs = 300_000,
    nonceTtlMs = 300_000,
    now = () => Date.now(),
  } = {}) {
    this.clients = parseClients(clients);
    this.maxSkewMs = maxSkewMs;
    this.nonceTtlMs = nonceTtlMs;
    this.now = now;
    this.usedNonces = new Map();
  }

  verify({ headers, method, path, body = {} }) {
    const clientId = requiredHeader(headers, 'x-client-id');
    const timestampRaw = requiredHeader(headers, 'x-timestamp');
    const nonce = requiredHeader(headers, 'x-nonce');
    const signatureRaw = requiredHeader(headers, 'x-signature');

    const publicKey = this.clients.get(clientId);
    if (!publicKey) {
      throw new GatewayError('unknown client_id', 401);
    }

    const timestamp = Number.parseInt(timestampRaw, 10);
    if (!Number.isFinite(timestamp)) {
      throw new GatewayError('invalid timestamp', 401);
    }

    const nowSeconds = Math.floor(this.now() / 1000);
    if (Math.abs(nowSeconds - timestamp) > Math.floor(this.maxSkewMs / 1000)) {
      throw new GatewayError('request expired', 401);
    }

    const canonical = buildCanonicalSignaturePayload({
      clientId,
      timestamp,
      nonce,
      method,
      path,
      body,
    });
    const signature = decodeBase64(signatureRaw, 'invalid signature');
    const ok = crypto.verify(null, canonical, publicKey, signature);
    if (!ok) {
      throw new GatewayError('invalid signature', 401);
    }

    this.useNonce(clientId, nonce);
    return { clientId };
  }

  useNonce(clientId, nonce) {
    const now = this.now();
    this.cleanupNonces(now);
    const key = `${clientId}:${nonce}`;
    if (this.usedNonces.has(key)) {
      throw new GatewayError('replay nonce', 401);
    }
    this.usedNonces.set(key, now + this.nonceTtlMs);
  }

  cleanupNonces(now = this.now()) {
    for (const [key, expiresAt] of this.usedNonces) {
      if (expiresAt <= now) {
        this.usedNonces.delete(key);
      }
    }
  }
}

export function buildCanonicalSignaturePayload({ clientId, timestamp, nonce, method, path, body }) {
  const bodyHash = crypto.createHash('sha256').update(stableJsonStringify(body)).digest('hex');
  return Buffer.from(
    stableJsonStringify({
      client_id: clientId,
      timestamp,
      nonce,
      method: String(method || 'GET').toUpperCase(),
      path,
      body_hash: bodyHash,
    })
  );
}

export function parseClients(value) {
  const clients = new Map();
  for (const entry of String(value || '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf(':');
    if (separator <= 0) {
      throw new Error('LIVEAVATAR_SIGNATURE_CLIENTS entries must use client_id:public_key_base64');
    }
    const clientId = trimmed.slice(0, separator).trim();
    const publicKeyBase64 = trimmed.slice(separator + 1).trim();
    if (!clientId || !publicKeyBase64) {
      throw new Error('LIVEAVATAR_SIGNATURE_CLIENTS entries must use client_id:public_key_base64');
    }
    clients.set(clientId, createEd25519PublicKey(publicKeyBase64));
  }
  return clients;
}

export function stableJsonStringify(value) {
  if (value === null || typeof value !== 'object') {
    return escapeJsonString(JSON.stringify(value));
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${escapeJsonString(JSON.stringify(key))}:${stableJsonStringify(value[key])}`)
    .join(',')}}`;
}

function createEd25519PublicKey(publicKeyBase64) {
  const rawPublicKey = decodeBase64(publicKeyBase64, 'invalid public key');
  if (rawPublicKey.length !== 32) {
    throw new Error('Ed25519 public keys must be raw 32-byte base64 values');
  }
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
    format: 'der',
    type: 'spki',
  });
}

function requiredHeader(headers, name) {
  const value = readHeader(headers, name);
  if (!value) {
    throw new GatewayError('missing signature headers', 401);
  }
  return value;
}

function readHeader(headers, name) {
  if (headers instanceof Headers) {
    return headers.get(name) || '';
  }
  return String(headers?.[name] || headers?.[name.toLowerCase()] || '');
}

function decodeBase64(value, message) {
  try {
    return Buffer.from(String(value || ''), 'base64');
  } catch {
    throw new GatewayError(message, 401);
  }
}

function escapeJsonString(value) {
  return value.replace(/[^\x00-\x7f]/g, (char) =>
    [...char]
      .map((part) => part.codePointAt(0).toString(16).padStart(4, '0'))
      .map((hex) => `\\u${hex}`)
      .join('')
  );
}
