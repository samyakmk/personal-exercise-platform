import type { Ref } from 'react';

export function videoMime(name: string, reportedMime: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  const reported = reportedMime.split(';', 1)[0].trim().toLowerCase();
  if (extension === 'mov') return 'video/quicktime';
  if (reported && reported !== 'application/octet-stream') return reported;
  return extension === 'mp4' ? 'video/mp4' : extension === 'webm' ? 'video/webm' : '';
}

export type VideoPlayerHandle = { seek: (seconds: number) => void; position: () => number; duration: () => number };

export type VideoPlayerProps = {
  uri: string;
  label: string;
  detailed?: boolean;
  onReady?: () => void;
  onError?: () => void;
  ref?: Ref<VideoPlayerHandle>;
};
