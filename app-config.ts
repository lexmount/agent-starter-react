export interface VideoTrackConfig {
  id: string;
  label: string;
  type: 'system' | 'livekit';
  livekitTrackName?: string; // LiveKit轨道名称（仅当type为'livekit'时使用）
  enabled: boolean;
  icon?: 'camera' | 'broadcast';
  description?: string;
}

export interface AppConfig {
  pageTitle: string;
  pageDescription: string;
  companyName: string;

  supportsChatInput: boolean;
  supportsVideoInput: boolean;
  supportsScreenShare: boolean;
  isPreConnectBufferEnabled: boolean;
  usesBrowserRawMediaInput?: boolean;

  logo: string;
  startButtonText: string;
  accent?: string;
  logoDark?: string;
  accentDark?: string;

  // for LiveKit Cloud Sandbox
  sandboxId?: string;
  agentName?: string;

  excludeAudioTracks: string[];
  showAudioFilterDebug?: boolean;

  // 全局调试配置
  enableGlobalDebug?: boolean; // 全局调试开关，控制所有调试信息的显示

  // 字幕和转录配置
  enableSmartParticipantMatching?: boolean; // 启用智能参与者匹配
  enableTranscriptionDebug?: boolean; // 启用转录调试日志
  showTranscriptByDefault?: boolean; // 默认显示字幕窗口
  userTranscriptionIdentities?: string[]; // 用户转录身份标识列表
  showParticipantNames?: boolean; // 是否显示参与者名称（user、agent-xxx等）

  // 视频轨道配置
  availableVideoTracks: VideoTrackConfig[];
  defaultVideoTrack?: string; // 默认选择的视频轨道ID
  showDefaultCameraPreview?: boolean; // 是否默认显示摄像头/视频输入预览
}

const FRONTDESK_DEVICE = (process.env.NEXT_PUBLIC_FRONTDESK_DEVICE || '').trim().toLowerCase();
const IS_BROWSER_FRONTDESK = FRONTDESK_DEVICE === 'browser';
const FRONTDESK_AGENT_NAME = (process.env.NEXT_PUBLIC_FRONTDESK_AGENT_NAME || '').trim();
const BROWSER_VIDEO_TRACK_NAME = 'browser_video_track';
const ROOM_INPUT_AUDIO_TRACK_NAME = 'room_audio';
const ROOM_INPUT_VIDEO_TRACK_NAME = 'room_video';

export const APP_CONFIG_DEFAULTS: AppConfig = {
  companyName: 'Lexmount',
  pageTitle: 'Lexmount Voice Agent',
  pageDescription: 'A voice agent built with Lexmount Agent Studio',

  supportsChatInput: true,
  supportsVideoInput: true,
  supportsScreenShare: !IS_BROWSER_FRONTDESK,
  isPreConnectBufferEnabled: true,
  usesBrowserRawMediaInput: IS_BROWSER_FRONTDESK,

  logo: '/lk-logo.png',
  accent: '#002cf2',
  logoDark: '/lk-logo-dark.png',
  accentDark: '#1fd5f9',
  startButtonText: 'Start call',

  // for LiveKit Cloud Sandbox
  sandboxId: undefined,
  agentName: FRONTDESK_AGENT_NAME || undefined,

  // 音频过滤配置
  excludeAudioTracks: [ROOM_INPUT_AUDIO_TRACK_NAME], // 要排除的音频轨道名称列表

  // 调试配置
  showAudioFilterDebug: process.env.NEXT_PUBLIC_SHOW_AUDIO_DEBUG === 'true' || false, // 是否显示音频过滤调试组件

  // 全局调试配置
  enableGlobalDebug: process.env.NEXT_PUBLIC_ENABLE_GLOBAL_DEBUG === 'true' || false, // 全局调试开关

  // 字幕和转录配置
  enableSmartParticipantMatching: true, // 启用智能参与者匹配，解决自定义音频track的字幕显示问题
  enableTranscriptionDebug: process.env.NEXT_PUBLIC_SHOW_TRANSCRIPTION_DEBUG === 'true' || false, // 转录调试日志
  showTranscriptByDefault: true, // 默认显示字幕窗口，交互时直接可见
  userTranscriptionIdentities: ['room_input'], // 用户转录身份标识（自定义音频track）
  showParticipantNames: false, // 默认不显示参与者名称（user、agent-xxx等）

  // 视频轨道配置
  showDefaultCameraPreview: !IS_BROWSER_FRONTDESK,
  availableVideoTracks: [
    ...(IS_BROWSER_FRONTDESK
      ? [
          {
            id: BROWSER_VIDEO_TRACK_NAME,
            label: '浏览器摄像头',
            type: 'livekit' as const,
            livekitTrackName: BROWSER_VIDEO_TRACK_NAME,
            enabled: true,
            icon: 'camera' as const,
            description: '浏览器原始摄像头画面',
          },
        ]
      : [
          {
            id: 'system_camera_default',
            label: '系统默认摄像头',
            type: 'system' as const,
            enabled: true,
            icon: 'camera' as const,
            description: '系统默认摄像头设备',
          },
        ]),
    {
      id: ROOM_INPUT_VIDEO_TRACK_NAME,
      label: '人脸检测频道',
      type: 'livekit',
      livekitTrackName: ROOM_INPUT_VIDEO_TRACK_NAME,
      enabled: true,
      icon: 'broadcast' as const,
      description: '前台统一视频预览',
    },
  ],
  defaultVideoTrack: ROOM_INPUT_VIDEO_TRACK_NAME, // 默认选择统一输入视频轨道
};
