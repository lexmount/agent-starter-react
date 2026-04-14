export interface VideoTrackConfig {
  id: string;
  label: string;
  type: 'system' | 'livekit';
  livekitTrackName?: string; // LiveKit轨道名称（仅当type为'livekit'时使用）
  enabled: boolean;
  icon?: string;
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
}

export const APP_CONFIG_DEFAULTS: AppConfig = {
  companyName: 'Lexmount',
  pageTitle: 'Lexmount Voice Agent',
  pageDescription: 'A voice agent built with Lexmount Agent Studio',

  supportsChatInput: true,
  supportsVideoInput: true,
  supportsScreenShare: true,
  isPreConnectBufferEnabled: true,

  logo: '/lk-logo.png',
  accent: '#002cf2',
  logoDark: '/lk-logo-dark.png',
  accentDark: '#1fd5f9',
  startButtonText: 'Start call',

  // for LiveKit Cloud Sandbox
  sandboxId: undefined,
  agentName: undefined,
  
  // 音频过滤配置
  excludeAudioTracks: [
    'xunfei_audio_track'
  ], // 要排除的音频轨道名称列表
  
  // 调试配置
  showAudioFilterDebug: process.env.NEXT_PUBLIC_SHOW_AUDIO_DEBUG === 'true' || false, // 是否显示音频过滤调试组件
  
  // 全局调试配置
  enableGlobalDebug: process.env.NEXT_PUBLIC_ENABLE_GLOBAL_DEBUG === 'true' || false, // 全局调试开关
  
  // 字幕和转录配置
  enableSmartParticipantMatching: true, // 启用智能参与者匹配，解决自定义音频track的字幕显示问题
  enableTranscriptionDebug: process.env.NEXT_PUBLIC_SHOW_TRANSCRIPTION_DEBUG === 'true' || false, // 转录调试日志
  showTranscriptByDefault: true, // 默认显示字幕窗口，交互时直接可见
  userTranscriptionIdentities: ['xunfei_service_agent'], // 用户转录身份标识（自定义音频track）
  showParticipantNames: false, // 默认不显示参与者名称（user、agent-xxx等）

  // 视频轨道配置
  availableVideoTracks: [
    {
      id: 'system_camera_default',
      label: '系统默认摄像头',
      type: 'system',
      enabled: true,
      icon: '📹',
      description: '系统默认摄像头设备',
    },
    {
      id: 'xunfei_video_track',
      label: '人脸检测频道',
      type: 'livekit',
      livekitTrackName: 'xunfei_video_track',
      enabled: true,
      icon: '📡',
      description: '讯飞人脸检测预览',
    },
  ],
  defaultVideoTrack: 'xunfei_video_track', // 默认选择用户指定的轨道
};
