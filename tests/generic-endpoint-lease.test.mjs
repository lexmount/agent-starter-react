import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  EndpointLeaseConflictError,
  EndpointLeaseUnavailableError,
  buildGenericEdgeControlUrl,
  loadGenericEndpointLeaseConfig,
  renewGenericEndpointLease,
  resolveActiveGenericEndpointLease,
} from '../lib/generic-endpoint-lease.ts';

const execFileAsync = promisify(execFile);

async function temporaryRegistry() {
  const directory = path.join(tmpdir(), `generic-endpoint-lease-${randomUUID()}`);
  await mkdir(directory, { mode: 0o700 });
  return directory;
}

async function publishLeaseRecord(directory, record) {
  const destination = path.join(directory, `${record.instanceId}.lease.json`);
  const temporary = path.join(directory, `.${record.instanceId}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
  await rename(temporary, destination);
  await chmod(destination, 0o600);
}

function freshLeaseRecord(overrides = {}) {
  return {
    deviceId: 'generic-orin',
    instanceId: '11111111-2222-4333-8444-555555555555',
    address: '10.2.2.200',
    receivedAt: '2026-08-24T10:01:00.000Z',
    expiresAt: '2026-08-24T10:01:45.000Z',
    ...overrides,
  };
}

function config(directory) {
  return loadGenericEndpointLeaseConfig({
    GENERIC_EDGE_MEDIA_DEVICE_ID: 'generic-orin',
    GENERIC_EDGE_MEDIA_ALLOWED_CIDRS: '10.2.0.0/16,192.168.10.0/24',
    GENERIC_ENDPOINT_REGISTRY_DIR: directory,
  });
}

function heartbeat(overrides = {}) {
  return {
    deviceId: 'generic-orin',
    instanceId: '11111111-2222-4333-8444-555555555555',
    hostname: 'orin',
    address: '10.2.2.199',
    ...overrides,
  };
}

test('lease renews for 45 seconds and same instance address changes atomically', async () => {
  const directory = await temporaryRegistry();
  const leaseConfig = config(directory);
  const first = await renewGenericEndpointLease(heartbeat(), leaseConfig, {
    now: () => new Date('2026-08-24T10:00:00.000Z'),
  });
  assert.equal(first.expiresAt, '2026-08-24T10:00:45.000Z');
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);

  await renewGenericEndpointLease(heartbeat({ address: '10.2.2.200' }), leaseConfig, {
    now: () => new Date('2026-08-24T10:00:10.000Z'),
  });
  const resolved = await resolveActiveGenericEndpointLease(leaseConfig, {
    now: () => new Date('2026-08-24T10:00:44.999Z'),
  });
  assert.equal(resolved.address, '10.2.2.200');
  assert.equal(buildGenericEdgeControlUrl(resolved, 'start'), 'http://10.2.2.200:8013/start');
  const persisted = JSON.parse(
    await readFile(path.join(directory, `${resolved.instanceId}.lease.json`))
  );
  assert.deepEqual(Object.keys(persisted).sort(), [
    'address',
    'deviceId',
    'expiresAt',
    'instanceId',
    'receivedAt',
  ]);
  assert.equal(JSON.stringify(persisted).includes('token'), false);
});

test('expired or conflicting leases fail closed', async () => {
  const directory = await temporaryRegistry();
  const leaseConfig = config(directory);
  await renewGenericEndpointLease(heartbeat(), leaseConfig, {
    now: () => new Date('2026-08-24T10:00:00.000Z'),
  });
  await assert.rejects(
    resolveActiveGenericEndpointLease(leaseConfig, {
      now: () => new Date('2026-08-24T10:00:45.000Z'),
    }),
    EndpointLeaseUnavailableError
  );

  await renewGenericEndpointLease(heartbeat(), leaseConfig, {
    now: () => new Date('2026-08-24T11:00:00.000Z'),
  });
  await assert.rejects(
    renewGenericEndpointLease(
      heartbeat({ instanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }),
      leaseConfig,
      { now: () => new Date('2026-08-24T11:00:10.000Z') }
    ),
    EndpointLeaseConflictError
  );
});

test('concurrent different instances cannot both acquire the single-device lease', async () => {
  const directory = await temporaryRegistry();
  const leaseConfig = config(directory);
  const results = await Promise.allSettled([
    renewGenericEndpointLease(heartbeat(), leaseConfig),
    renewGenericEndpointLease(
      heartbeat({ instanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }),
      leaseConfig
    ),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected);
  assert.ok(rejected.reason instanceof EndpointLeaseConflictError);
  await resolveActiveGenericEndpointLease(leaseConfig);
});

test('resolver serializes an expired read with same-instance renewal in-process', async () => {
  const directory = await temporaryRegistry();
  const leaseConfig = config(directory);
  await renewGenericEndpointLease(heartbeat(), leaseConfig, {
    now: () => new Date('2026-08-24T10:00:00.000Z'),
  });
  const lockPath = path.join(directory, '.generic-endpoint-lease.lock');
  await writeFile(lockPath, `${process.pid}\n`, { mode: 0o600 });

  const resolving = resolveActiveGenericEndpointLease(leaseConfig, {
    now: () => new Date('2026-08-24T10:01:00.000Z'),
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  await publishLeaseRecord(directory, freshLeaseRecord());
  await unlink(lockPath);

  const resolved = await resolving;
  assert.equal(resolved.address, '10.2.2.200');
  assert.equal(
    (
      await resolveActiveGenericEndpointLease(leaseConfig, {
        now: () => new Date('2026-08-24T10:01:01.000Z'),
      })
    ).address,
    '10.2.2.200'
  );
});

test('same-host resolver worker cannot delete a renewal published behind the registry lock', async () => {
  const directory = await temporaryRegistry();
  const leaseConfig = config(directory);
  await renewGenericEndpointLease(heartbeat(), leaseConfig, {
    now: () => new Date('2026-08-24T10:00:00.000Z'),
  });
  const lockPath = path.join(directory, '.generic-endpoint-lease.lock');
  await writeFile(lockPath, `${process.pid}\n`, { mode: 0o600 });
  const moduleUrl = pathToFileURL(path.resolve('lib/generic-endpoint-lease.ts')).href;
  const environment = {
    GENERIC_EDGE_MEDIA_DEVICE_ID: 'generic-orin',
    GENERIC_EDGE_MEDIA_ALLOWED_CIDRS: '10.2.0.0/16',
    GENERIC_ENDPOINT_REGISTRY_DIR: directory,
  };
  const reader = `
    import { loadGenericEndpointLeaseConfig, resolveActiveGenericEndpointLease } from ${JSON.stringify(moduleUrl)};
    const config = loadGenericEndpointLeaseConfig(${JSON.stringify(environment)});
    process.stdout.write(JSON.stringify(await resolveActiveGenericEndpointLease(config, {
      now: () => new Date('2026-08-24T10:01:00.000Z'),
    })));
  `;
  const worker = execFileAsync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', reader],
    { cwd: process.cwd() }
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  await publishLeaseRecord(directory, freshLeaseRecord());
  await unlink(lockPath);

  const { stdout } = await worker;
  assert.equal(JSON.parse(stdout).address, '10.2.2.200');
  assert.equal(
    (
      await resolveActiveGenericEndpointLease(leaseConfig, {
        now: () => new Date('2026-08-24T10:01:01.000Z'),
      })
    ).address,
    '10.2.2.200'
  );
});

test('a stale dead-process registry lock is recovered on the next heartbeat', async () => {
  const directory = await temporaryRegistry();
  const lockPath = path.join(directory, '.generic-endpoint-lease.lock');
  await writeFile(lockPath, '999999999\n', { mode: 0o600 });
  const stale = new Date(Date.now() - 11_000);
  await utimes(lockPath, stale, stale);

  const lease = await renewGenericEndpointLease(heartbeat(), config(directory));

  assert.equal(lease.instanceId, heartbeat().instanceId);
  await assert.rejects(lstat(lockPath), { code: 'ENOENT' });
});

test('lease validation rejects unsafe addresses and target injection', async () => {
  const directory = await temporaryRegistry();
  const leaseConfig = config(directory);
  for (const address of [
    '8.8.8.8',
    '127.0.0.1',
    '169.254.1.2',
    '224.0.0.1',
    '::1',
    'orin.local',
    '10.2.2.199:9000',
    '010.002.002.199',
  ]) {
    await assert.rejects(renewGenericEndpointLease(heartbeat({ address }), leaseConfig), /address/);
  }
  await assert.rejects(
    renewGenericEndpointLease(heartbeat({ address: '172.16.1.2' }), leaseConfig),
    /allowed CIDR/
  );
});

test('registry rejects symlink and unsafe permissions', async () => {
  const parent = await temporaryRegistry();
  const real = path.join(parent, 'real');
  const linked = path.join(parent, 'linked');
  await mkdir(real, { mode: 0o700 });
  await symlink(real, linked);
  await assert.rejects(
    renewGenericEndpointLease(heartbeat(), config(linked)),
    /registry directory/
  );

  const unsafe = path.join(parent, 'unsafe');
  await mkdir(unsafe, { mode: 0o755 });
  await chmod(unsafe, 0o755);
  await assert.rejects(renewGenericEndpointLease(heartbeat(), config(unsafe)), /0700/);
});

test('corrupt and unsafe lease files fail closed', async () => {
  const directory = await temporaryRegistry();
  const leaseConfig = config(directory);
  const corrupt = path.join(directory, '11111111-2222-4333-8444-555555555555.lease.json');
  await writeFile(corrupt, '{}', { mode: 0o600 });
  await assert.rejects(resolveActiveGenericEndpointLease(leaseConfig), /lease record/);
  await writeFile(corrupt, JSON.stringify(heartbeat()), { mode: 0o600 });
  await chmod(corrupt, 0o644);
  await assert.rejects(resolveActiveGenericEndpointLease(leaseConfig), /0600/);
});

test('configuration has no static Generic URL and rejects unsupported multi-host mode', () => {
  const directory = '/tmp/generic-lease-test';
  assert.throws(() => config('relative/path'), /absolute/);
  assert.throws(
    () =>
      loadGenericEndpointLeaseConfig({
        GENERIC_EDGE_MEDIA_DEVICE_ID: 'generic-orin',
        GENERIC_EDGE_MEDIA_ALLOWED_CIDRS: '10.2.0.0/16',
        GENERIC_ENDPOINT_REGISTRY_DIR: directory,
        GENERIC_ENDPOINT_MULTI_HOST: '1',
      }),
    /multi-host/
  );
  const resolved = config(directory);
  assert.equal('edgeMediaUrl' in resolved, false);
});

test('fresh same-host processes share the persisted active lease', async () => {
  const directory = await temporaryRegistry();
  const moduleUrl = pathToFileURL(path.resolve('lib/generic-endpoint-lease.ts')).href;
  const environment = {
    GENERIC_EDGE_MEDIA_DEVICE_ID: 'generic-orin',
    GENERIC_EDGE_MEDIA_ALLOWED_CIDRS: '10.2.0.0/16',
    GENERIC_ENDPOINT_REGISTRY_DIR: directory,
  };
  const writer = `
    import { loadGenericEndpointLeaseConfig, renewGenericEndpointLease } from ${JSON.stringify(moduleUrl)};
    const config = loadGenericEndpointLeaseConfig(${JSON.stringify(environment)});
    await renewGenericEndpointLease(${JSON.stringify(heartbeat())}, config);
  `;
  await execFileAsync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', writer],
    { cwd: process.cwd() }
  );

  const parentRead = await resolveActiveGenericEndpointLease(config(directory));
  assert.equal(parentRead.address, '10.2.2.199');

  const reader = `
    import { loadGenericEndpointLeaseConfig, resolveActiveGenericEndpointLease } from ${JSON.stringify(moduleUrl)};
    const config = loadGenericEndpointLeaseConfig(${JSON.stringify(environment)});
    process.stdout.write(JSON.stringify(await resolveActiveGenericEndpointLease(config)));
  `;
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', reader],
    { cwd: process.cwd() }
  );
  assert.equal(JSON.parse(stdout).instanceId, heartbeat().instanceId);
});
