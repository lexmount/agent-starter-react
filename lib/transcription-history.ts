import { type TextStreamData } from '@livekit/components-react';

const DEFAULT_TRANSCRIPTION_HISTORY_SIZE = 100;

/**
 * Keep completed text streams even when LiveKit replaces the current entry for
 * the same speech segment. A tool preamble and its final answer can share one
 * segment id while still arriving as distinct text streams.
 */
export function mergeTranscriptionHistory(
  previous: TextStreamData[],
  current: TextStreamData[],
  maxEntries = DEFAULT_TRANSCRIPTION_HISTORY_SIZE
): TextStreamData[] {
  if (current.length === 0) return previous;

  const byStreamId = new Map(previous.map((entry) => [entry.streamInfo.id, entry]));
  current.forEach((entry) => {
    const segmentId = entry.streamInfo.attributes?.['lk.segment_id'];
    const finalValue = entry.streamInfo.attributes?.['lk.transcription_final'];
    const hasFinalState = finalValue === true || finalValue === false
      || finalValue === 'true' || finalValue === 'false';

    if (segmentId && hasFinalState) {
      for (const [streamId, existing] of byStreamId) {
        const sameSegment = existing.streamInfo.attributes?.['lk.segment_id'] === segmentId;
        const sameParticipant = existing.participantInfo.identity === entry.participantInfo.identity;
        const existingFinal = existing.streamInfo.attributes?.['lk.transcription_final'];
        const existingIsPartial = existingFinal === false || existingFinal === 'false';
        if (sameSegment && sameParticipant && existingIsPartial) {
          byStreamId.delete(streamId);
        }
      }
    }

    byStreamId.set(entry.streamInfo.id, entry);
  });

  return Array.from(byStreamId.values())
    .sort((a, b) => a.streamInfo.timestamp - b.streamInfo.timestamp)
    .slice(-maxEntries);
}
