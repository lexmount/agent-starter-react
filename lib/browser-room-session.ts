import { isValidConnectionRoomId } from './connection-room-id';

const BROWSER_ROOM_ID_STORAGE_KEY = 'lexvoice.browser_room_id.v1';

let fallbackRoomId: string | null = null;

export function getBrowserRoomSessionId(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined = getSessionStorage(),
  createRoomId: () => string = () => crypto.randomUUID()
) {
  if (storage) {
    try {
      const storedRoomId = storage.getItem(BROWSER_ROOM_ID_STORAGE_KEY);
      if (isValidConnectionRoomId(storedRoomId)) {
        fallbackRoomId = storedRoomId.trim();
        return fallbackRoomId;
      }

      const roomId = createRoomId();
      storage.setItem(BROWSER_ROOM_ID_STORAGE_KEY, roomId);
      fallbackRoomId = roomId;
      return roomId;
    } catch {
      // Fall through to in-memory storage when sessionStorage is blocked.
    }
  }

  if (isValidConnectionRoomId(fallbackRoomId)) {
    return fallbackRoomId;
  }

  fallbackRoomId = createRoomId();
  return fallbackRoomId;
}

export function resetBrowserRoomSessionId(
  storage: Pick<Storage, 'removeItem'> | null | undefined = getSessionStorage()
) {
  fallbackRoomId = null;
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(BROWSER_ROOM_ID_STORAGE_KEY);
  } catch {
    // Ignore blocked sessionStorage and rely on the in-memory fallback reset.
  }
}

function getSessionStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage;
}
