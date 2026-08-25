import { timingSafeEqual } from 'node:crypto';

export const ENDPOINT_CONNECTIVITY_TOKEN_HEADER = 'x-endpoint-connectivity-token';

export type EndpointConnectivityPayload = {
  deviceId: string;
  instanceId: string;
  hostname: string;
  address: string;
};

type ParseResult =
  | { ok: true; payload: EndpointConnectivityPayload }
  | { ok: false; error: string };

const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const INSTANCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function secretsMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function readConnectivityToken(request: Request): string {
  const direct = (request.headers.get(ENDPOINT_CONNECTIVITY_TOKEN_HEADER) || '').trim();
  if (direct) {
    return direct;
  }

  const authorization = (request.headers.get('authorization') || '').trim();
  const [scheme, token] = authorization.split(/\s+/, 2);
  return scheme?.toLowerCase() === 'bearer' ? (token || '').trim() : '';
}

export function parseEndpointConnectivityPayload(input: unknown): ParseResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'JSON object is required' };
  }

  const record = input as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'address,deviceId,hostname,instanceId') {
    return { ok: false, error: 'heartbeat fields do not match the contract' };
  }
  const deviceId = readOptionalString(record.deviceId);
  if (!deviceId || !DEVICE_ID_PATTERN.test(deviceId)) {
    return {
      ok: false,
      error: 'deviceId must contain 1-128 letters, numbers, dots, underscores, colons, or hyphens',
    };
  }

  const instanceId = readOptionalString(record.instanceId);
  if (!INSTANCE_ID_PATTERN.test(instanceId)) {
    return { ok: false, error: 'instanceId must be an RFC 4122 version 4 UUID' };
  }
  const hostname = readOptionalString(record.hostname);
  const address = readOptionalString(record.address);
  if (!hostname || hostname.length > 255) {
    return { ok: false, error: 'hostname must contain 1-255 characters' };
  }
  if (!address || address.length > 15) {
    return { ok: false, error: 'address must be a canonical IPv4 address' };
  }

  return {
    ok: true,
    payload: {
      deviceId,
      instanceId: instanceId.toLowerCase(),
      hostname,
      address,
    },
  };
}

function readOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
