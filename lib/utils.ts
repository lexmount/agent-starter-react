import { cache } from 'react';
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { APP_CONFIG_DEFAULTS, buildDefaultVideoTracks } from '@/app-config';
import type { AppConfig } from '@/app-config';

export const CONFIG_ENDPOINT =
  process.env.APP_CONFIG_ENDPOINT || process.env.NEXT_PUBLIC_APP_CONFIG_ENDPOINT;
export const SANDBOX_ID = process.env.SANDBOX_ID;

export const THEME_STORAGE_KEY = 'theme-mode';
export const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export interface SandboxConfig {
  [key: string]:
    | { type: 'string'; value: string }
    | { type: 'number'; value: number }
    | { type: 'boolean'; value: boolean }
    | null;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return '';
}

function readBooleanEnv(defaultValue: boolean, ...names: string[]) {
  const value = readEnv(...names).toLowerCase();
  if (!value) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function readNumberEnv(defaultValue: number, ...names: string[]) {
  const parsed = Number(readEnv(...names));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export function getClientConfigFromEnv(): AppConfig {
  const inputSource = readEnv(
    'INPUT_SOURCE',
    'NEXT_PUBLIC_INPUT_SOURCE',
    'NEXT_PUBLIC_LEXVOICE_DEVICE',
    'NEXT_PUBLIC_FRONTDESK_DEVICE'
  ).toLowerCase();
  const isBrowserInput = inputSource === 'browser';
  const agentName = readEnv(
    'AGENT_NAME',
    'NEXT_PUBLIC_AGENT_NAME',
    'NEXT_PUBLIC_LEXVOICE_AGENT_NAME',
    'NEXT_PUBLIC_FRONTDESK_AGENT_NAME'
  );

  return {
    ...APP_CONFIG_DEFAULTS,
    supportsScreenShare: isBrowserInput ? false : APP_CONFIG_DEFAULTS.supportsScreenShare,
    usesBrowserRawMediaInput: isBrowserInput,
    agentName: agentName || undefined,
    showDefaultCameraPreview: isBrowserInput ? false : APP_CONFIG_DEFAULTS.showDefaultCameraPreview,
    availableVideoTracks: buildDefaultVideoTracks(isBrowserInput),
    browserMediaStreamName:
      readEnv(
        'BROWSER_MEDIA_STREAM_NAME',
        'NEXT_PUBLIC_BROWSER_MEDIA_STREAM_NAME',
        'NEXT_PUBLIC_LEXVOICE_BROWSER_MEDIA_STREAM_NAME',
        'NEXT_PUBLIC_FRONTDESK_BROWSER_MEDIA_STREAM_NAME'
      ) || APP_CONFIG_DEFAULTS.browserMediaStreamName,
    browserVideoWidth: readNumberEnv(
      APP_CONFIG_DEFAULTS.browserVideoWidth ?? 1280,
      'BROWSER_VIDEO_WIDTH',
      'NEXT_PUBLIC_BROWSER_VIDEO_WIDTH',
      'NEXT_PUBLIC_LEXVOICE_BROWSER_VIDEO_WIDTH',
      'NEXT_PUBLIC_FRONTDESK_BROWSER_VIDEO_WIDTH'
    ),
    browserVideoHeight: readNumberEnv(
      APP_CONFIG_DEFAULTS.browserVideoHeight ?? 720,
      'BROWSER_VIDEO_HEIGHT',
      'NEXT_PUBLIC_BROWSER_VIDEO_HEIGHT',
      'NEXT_PUBLIC_LEXVOICE_BROWSER_VIDEO_HEIGHT',
      'NEXT_PUBLIC_FRONTDESK_BROWSER_VIDEO_HEIGHT'
    ),
    browserVideoFps: readNumberEnv(
      APP_CONFIG_DEFAULTS.browserVideoFps ?? 15,
      'BROWSER_VIDEO_FPS',
      'NEXT_PUBLIC_BROWSER_VIDEO_FPS',
      'NEXT_PUBLIC_LEXVOICE_BROWSER_VIDEO_FPS',
      'NEXT_PUBLIC_FRONTDESK_BROWSER_VIDEO_FPS'
    ),
    browserVideoMaxBitrate: readNumberEnv(
      APP_CONFIG_DEFAULTS.browserVideoMaxBitrate ?? 1700000,
      'BROWSER_VIDEO_MAX_BITRATE',
      'NEXT_PUBLIC_BROWSER_VIDEO_MAX_BITRATE',
      'NEXT_PUBLIC_LEXVOICE_BROWSER_VIDEO_MAX_BITRATE',
      'NEXT_PUBLIC_FRONTDESK_BROWSER_VIDEO_MAX_BITRATE'
    ),
    remoteVideoWidth: readNumberEnv(
      APP_CONFIG_DEFAULTS.remoteVideoWidth ?? 1280,
      'REMOTE_VIDEO_WIDTH',
      'NEXT_PUBLIC_REMOTE_VIDEO_WIDTH',
      'NEXT_PUBLIC_LEXVOICE_REMOTE_VIDEO_WIDTH',
      'NEXT_PUBLIC_FRONTDESK_REMOTE_VIDEO_WIDTH'
    ),
    remoteVideoHeight: readNumberEnv(
      APP_CONFIG_DEFAULTS.remoteVideoHeight ?? 720,
      'REMOTE_VIDEO_HEIGHT',
      'NEXT_PUBLIC_REMOTE_VIDEO_HEIGHT',
      'NEXT_PUBLIC_LEXVOICE_REMOTE_VIDEO_HEIGHT',
      'NEXT_PUBLIC_FRONTDESK_REMOTE_VIDEO_HEIGHT'
    ),
    remoteVideoFps: readNumberEnv(
      APP_CONFIG_DEFAULTS.remoteVideoFps ?? 15,
      'REMOTE_VIDEO_FPS',
      'NEXT_PUBLIC_REMOTE_VIDEO_FPS',
      'NEXT_PUBLIC_LEXVOICE_REMOTE_VIDEO_FPS',
      'NEXT_PUBLIC_FRONTDESK_REMOTE_VIDEO_FPS'
    ),
    debugAudio: readBooleanEnv(
      APP_CONFIG_DEFAULTS.debugAudio ?? false,
      'DEBUG_AUDIO',
      'NEXT_PUBLIC_DEBUG_AUDIO',
      'NEXT_PUBLIC_LEXVOICE_DEBUG_AUDIO',
      'NEXT_PUBLIC_FRONTDESK_DEBUG_AUDIO'
    ),
    debugVideo: readBooleanEnv(
      APP_CONFIG_DEFAULTS.debugVideo ?? false,
      'DEBUG_VIDEO',
      'NEXT_PUBLIC_DEBUG_VIDEO',
      'NEXT_PUBLIC_LEXVOICE_DEBUG_VIDEO',
      'NEXT_PUBLIC_FRONTDESK_DEBUG_VIDEO'
    ),
  };
}

// https://react.dev/reference/react/cache#caveats
// > React will invalidate the cache for all memoized functions for each server request.
export const getAppConfig = cache(async (headers: Headers): Promise<AppConfig> => {
  const envConfig = getClientConfigFromEnv();

  if (CONFIG_ENDPOINT) {
    const sandboxId = SANDBOX_ID ?? headers.get('x-sandbox-id') ?? '';

    try {
      if (!sandboxId) {
        throw new Error('Sandbox ID is required');
      }

      const response = await fetch(CONFIG_ENDPOINT, {
        cache: 'no-store',
        headers: { 'X-Sandbox-ID': sandboxId },
      });

      const remoteConfig: SandboxConfig = await response.json();
      const config: AppConfig = { ...envConfig, sandboxId };

      for (const [key, entry] of Object.entries(remoteConfig)) {
        if (entry === null) continue;
        // Only include app config entries that are declared in defaults and, if set,
        // share the same primitive type as the default value.
        if (
          (key in APP_CONFIG_DEFAULTS &&
            APP_CONFIG_DEFAULTS[key as keyof AppConfig] === undefined) ||
          (typeof config[key as keyof AppConfig] === entry.type &&
            typeof config[key as keyof AppConfig] === typeof entry.value)
        ) {
          // @ts-expect-error I'm not sure quite how to appease TypeScript, but we've thoroughly checked types above
          config[key as keyof AppConfig] = entry.value as AppConfig[keyof AppConfig];
        }
      }

      return config;
    } catch (error) {
      console.error('ERROR: getAppConfig() - lib/utils.ts', error);
    }
  }

  return envConfig;
});

// check provided accent colors against defaults
// apply styles if they differ (or in development mode)
// generate a hover color for the accent color by mixing it with 20% black
export function getStyles(appConfig: AppConfig) {
  const { accent, accentDark } = appConfig;

  return [
    accent
      ? `:root { --primary: ${accent}; --primary-hover: color-mix(in srgb, ${accent} 80%, #000); }`
      : '',
    accentDark
      ? `.dark { --primary: ${accentDark}; --primary-hover: color-mix(in srgb, ${accentDark} 80%, #000); }`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
