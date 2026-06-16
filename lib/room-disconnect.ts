import { Room, RoomEvent } from 'livekit-client';

export function waitForRoomDisconnected(room: Room): Promise<void> {
  if (room.state === 'disconnected') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;

    const onDisconnected = () => {
      if (settled) {
        return;
      }
      settled = true;
      room.off(RoomEvent.Disconnected, onDisconnected);
      resolve();
    };

    room.on(RoomEvent.Disconnected, onDisconnected);
    room.disconnect();

    if (room.state === 'disconnected') {
      onDisconnected();
    }
  });
}
