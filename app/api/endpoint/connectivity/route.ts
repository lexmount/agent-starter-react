import { NextResponse } from 'next/server';
import {
  parseEndpointConnectivityPayload,
  readConnectivityToken,
  secretsMatch,
} from '@/lib/endpoint-connectivity';
import {
  EndpointLeaseConflictError,
  loadGenericEndpointLeaseConfig,
  renewGenericEndpointLease,
} from '@/lib/generic-endpoint-lease';

export const runtime = 'nodejs';
export const revalidate = 0;

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  const expectedToken = (process.env.ENDPOINT_CONNECTIVITY_TOKEN || '').trim();
  const actualToken = readConnectivityToken(request);
  if (!expectedToken) {
    return NextResponse.json(
      { status: 'error', error: 'endpoint connectivity probe is not configured' },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }
  if (!actualToken || !secretsMatch(actualToken, expectedToken)) {
    return NextResponse.json(
      { status: 'error', error: 'unauthorized' },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json(
      { status: 'error', error: 'valid JSON body is required' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const parsed = parseEndpointConnectivityPayload(input);
  if (!parsed.ok) {
    return NextResponse.json(
      { status: 'error', error: parsed.error },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const lease = await renewGenericEndpointLease(parsed.payload, loadGenericEndpointLeaseConfig());
    console.info('Generic endpoint heartbeat accepted', {
      deviceId: lease.deviceId,
      instanceId: lease.instanceId,
      address: lease.address,
      receivedAt: lease.receivedAt,
      expiresAt: lease.expiresAt,
    });
    return NextResponse.json(
      { status: 'leased', ...lease, hostname: parsed.payload.hostname },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    const conflict = error instanceof EndpointLeaseConflictError;
    return NextResponse.json(
      {
        status: 'error',
        error: conflict ? 'active endpoint instance conflict' : 'endpoint heartbeat rejected',
      },
      { status: conflict ? 409 : 400, headers: NO_STORE_HEADERS }
    );
  }
}
