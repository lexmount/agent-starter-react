import { Track } from 'livekit-client';
import type { TrackProcessor, VideoProcessorOptions } from 'livekit-client';

const PROCESSOR_NAME = 'browser-video-mirror';
const FALLBACK_VIDEO_WIDTH = 640;
const FALLBACK_VIDEO_HEIGHT = 480;
const FALLBACK_FRAME_RATE = 25;

class BrowserVideoMirrorProcessor
  implements TrackProcessor<Track.Kind.Video, VideoProcessorOptions>
{
  readonly name = PROCESSOR_NAME;
  processedTrack?: MediaStreamTrack;

  private canvas?: HTMLCanvasElement;
  private context?: CanvasRenderingContext2D;
  private element?: HTMLVideoElement;
  private videoFrameCallbackId?: number;
  private animationFrameId?: number;

  async init(options: VideoProcessorOptions): Promise<void> {
    const element = options.element as HTMLVideoElement | undefined;
    if (!element) {
      throw new Error('Browser video mirror processor requires a video element');
    }

    const settings = options.track.getSettings();
    const width = settings.width || element.videoWidth || FALLBACK_VIDEO_WIDTH;
    const height = settings.height || element.videoHeight || FALLBACK_VIDEO_HEIGHT;
    const frameRate = settings.frameRate || FALLBACK_FRAME_RATE;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Browser video mirror processor could not create a 2D canvas context');
    }

    const captureStream = canvas.captureStream(frameRate);
    const processedTrack = captureStream.getVideoTracks()[0];
    if (!processedTrack) {
      throw new Error('Browser video mirror processor did not produce a video track');
    }

    this.canvas = canvas;
    this.context = context;
    this.element = element;
    this.processedTrack = processedTrack;
    this.scheduleNextFrame();
  }

  async restart(options: VideoProcessorOptions): Promise<void> {
    if (!this.canvas || !this.context || !this.processedTrack) {
      await this.init(options);
      return;
    }

    this.cancelScheduledFrame();
    this.element = options.element as HTMLVideoElement | undefined;
    if (!this.element) {
      throw new Error('Browser video mirror processor requires a video element');
    }

    const settings = options.track.getSettings();
    this.canvas.width = settings.width || this.element.videoWidth || FALLBACK_VIDEO_WIDTH;
    this.canvas.height = settings.height || this.element.videoHeight || FALLBACK_VIDEO_HEIGHT;
    this.scheduleNextFrame();
  }

  async destroy(): Promise<void> {
    this.cancelScheduledFrame();
    this.processedTrack?.stop();
    this.processedTrack = undefined;
    this.context = undefined;
    this.canvas = undefined;
    this.element = undefined;
  }

  private drawFrame = () => {
    const canvas = this.canvas;
    const context = this.context;
    const element = this.element;
    if (!canvas || !context || !element) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(-1, 0, 0, 1, canvas.width, 0);
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    context.setTransform(1, 0, 0, 1, 0, 0);
    this.scheduleNextFrame();
  };

  private scheduleNextFrame(): void {
    const element = this.element;
    if (!element) {
      return;
    }

    if (typeof element.requestVideoFrameCallback === 'function') {
      this.videoFrameCallbackId = element.requestVideoFrameCallback(this.drawFrame);
      return;
    }

    this.animationFrameId = globalThis.requestAnimationFrame(this.drawFrame);
  }

  private cancelScheduledFrame(): void {
    if (
      this.videoFrameCallbackId !== undefined &&
      this.element &&
      typeof this.element.cancelVideoFrameCallback === 'function'
    ) {
      this.element.cancelVideoFrameCallback(this.videoFrameCallbackId);
    }
    if (this.animationFrameId !== undefined) {
      globalThis.cancelAnimationFrame(this.animationFrameId);
    }
    this.videoFrameCallbackId = undefined;
    this.animationFrameId = undefined;
  }
}

export function createBrowserVideoMirrorProcessor(): TrackProcessor<
  Track.Kind.Video,
  VideoProcessorOptions
> {
  return new BrowserVideoMirrorProcessor();
}
