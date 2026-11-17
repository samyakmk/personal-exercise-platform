import { createHash } from 'node:crypto';

export const maxSeriesOccurrences = 12;

export function seriesWorkoutId(seriesId, index) {
  if (!index) return seriesId;
  // Preserve the persisted occurrence IDs used by earlier weekly schedules.
  const hash = createHash('sha256').update(`repform-weekly:${seriesId}:${index}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
