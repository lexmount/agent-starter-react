import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAppConfigDefaults } from '../app-config.ts';

test('uses browser raw video track as the default video track in browser mode', () => {
  const defaults = buildAppConfigDefaults('browser');
  const browserTrack = defaults.availableVideoTracks.find((track) => track.id === 'browser_video_track');
  const roomInputTrack = defaults.availableVideoTracks.find((track) => track.id === 'room_video');

  assert.ok(browserTrack, 'expected a configured browser raw video track');
  assert.ok(roomInputTrack, 'expected a configured room input video track');
  assert.equal(browserTrack.type, 'livekit');
  assert.equal(browserTrack.livekitTrackName, 'browser_video_track');
  assert.equal(roomInputTrack.livekitTrackName, 'room_video');
  assert.equal(defaults.defaultVideoTrack, 'browser_video_track');
});

test('uses unified room input video track as the default remote preview track outside browser mode', () => {
  const defaults = buildAppConfigDefaults('xunfei');
  const systemTrack = defaults.availableVideoTracks.find((track) => track.id === 'system_camera_default');
  const remoteTrack = defaults.availableVideoTracks.find((track) => track.type === 'livekit');

  assert.ok(systemTrack, 'expected a configured system camera track');
  assert.ok(remoteTrack, 'expected a configured remote video track');
  assert.equal(systemTrack.publishTrackName, undefined);
  assert.equal(remoteTrack.livekitTrackName, 'room_video');
  assert.equal(defaults.defaultVideoTrack, 'room_video');
});
