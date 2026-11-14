export type UploadVideoOptions = {
  url: string;
  body: Blob;
  mime: string;
  name: string;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
};

export function uploadCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new Error('Upload cancelled.');
}
