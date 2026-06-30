const DEFAULT_ROLE_INPUT_DEVICE = 'xunfei';
const VALID_INPUT_DEVICES = new Set(['xunfei', 'generic', 'primebot', 'browser']);
const SERVER_ROOM_INPUT_DEVICES = new Set(['xunfei', 'generic']);

export type RoomInputControlAction = 'start' | 'stop';

export interface ResolveRoomInputStopUrlsOptions {
  inputSource?: string | null;
  audioInputDevice?: string | null;
  visionInputDevice?: string | null;
  roomAudioInputUrl?: string | null;
  roomVisionInputUrl?: string | null;
  roomInputUrl?: string | null;
  frontdeskInputParticipantUrl?: string | null;
  faceServiceUrl?: string | null;
  genericCameraParticipantUrl?: string | null;
}

export function resolveLiveKitHttpUrl(liveKitUrl?: string | null): string | undefined {
  const normalized = liveKitUrl?.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.startsWith('wss://')) {
    return `https://${normalized.slice('wss://'.length)}`;
  }
  if (normalized.startsWith('ws://')) {
    return `http://${normalized.slice('ws://'.length)}`;
  }
  return normalized;
}

function normalizeInputSource(inputSource?: string | null): string {
  const normalized = (inputSource || '').trim().toLowerCase();
  return normalized || 'browser';
}

function normalizeRoleInputDevice(
  inputDevice: string | null | undefined,
  fallback: string
): string {
  const normalized = (inputDevice || '').trim().toLowerCase();
  if (VALID_INPUT_DEVICES.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function addRoomInputStopUrl(urls: Set<string>, rawUrl?: string | null): void {
  const stopUrl = normalizeRoomInputControlUrl(rawUrl || '', 'stop');
  if (stopUrl) {
    urls.add(stopUrl);
  }
}

export function normalizeRoomInputControlUrl(
  rawUrl: string,
  action: RoomInputControlAction
): string {
  const value = rawUrl.trim();
  if (!value) {
    return '';
  }

  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, '');
    const otherAction = action === 'stop' ? 'start' : 'stop';
    if (pathname.endsWith(`/${otherAction}`)) {
      url.pathname = `${pathname.slice(0, -1 * (otherAction.length + 1))}/${action}`;
    } else if (!pathname.endsWith(`/${action}`)) {
      url.pathname = `${pathname}/${action}`;
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    const withoutTrailingSlash = value.replace(/\/+$/, '');
    if (withoutTrailingSlash.endsWith(`/${action}`)) {
      return withoutTrailingSlash;
    }

    const otherAction = action === 'stop' ? 'start' : 'stop';
    if (withoutTrailingSlash.endsWith(`/${otherAction}`)) {
      return `${withoutTrailingSlash.slice(0, -1 * (otherAction.length + 1))}/${action}`;
    }
    return `${withoutTrailingSlash}/${action}`;
  }
}

export function resolveRoomInputStopUrls({
  inputSource,
  audioInputDevice,
  visionInputDevice,
  roomAudioInputUrl,
  roomVisionInputUrl,
  roomInputUrl,
  frontdeskInputParticipantUrl,
  faceServiceUrl,
  genericCameraParticipantUrl,
}: ResolveRoomInputStopUrlsOptions): string[] {
  const normalizedInputSource = normalizeInputSource(inputSource);
  const isMixedInputSource = normalizedInputSource === 'mixed';
  const baseInputDevice = isMixedInputSource
    ? DEFAULT_ROLE_INPUT_DEVICE
    : normalizeRoleInputDevice(normalizedInputSource, DEFAULT_ROLE_INPUT_DEVICE);
  const resolvedAudioInputDevice = isMixedInputSource
    ? normalizeRoleInputDevice(audioInputDevice, baseInputDevice)
    : baseInputDevice;
  const resolvedVisionInputDevice = isMixedInputSource
    ? normalizeRoleInputDevice(visionInputDevice, baseInputDevice)
    : baseInputDevice;

  const urls = new Set<string>();
  const selectedServerDevices = new Set<string>();

  if (SERVER_ROOM_INPUT_DEVICES.has(resolvedAudioInputDevice)) {
    selectedServerDevices.add(resolvedAudioInputDevice);
    addRoomInputStopUrl(urls, roomAudioInputUrl || roomInputUrl);
  }
  if (SERVER_ROOM_INPUT_DEVICES.has(resolvedVisionInputDevice)) {
    selectedServerDevices.add(resolvedVisionInputDevice);
    addRoomInputStopUrl(urls, roomVisionInputUrl || roomInputUrl);
  }
  if (selectedServerDevices.size === 0) {
    return [];
  }

  if (selectedServerDevices.has('xunfei')) {
    addRoomInputStopUrl(urls, frontdeskInputParticipantUrl);
    addRoomInputStopUrl(urls, faceServiceUrl);
  }
  if (selectedServerDevices.has('generic')) {
    addRoomInputStopUrl(urls, genericCameraParticipantUrl);
  }

  return [...urls];
}
