import { uploadCancelled } from './uploadVideoTypes';
import type { UploadVideoOptions } from './uploadVideoTypes';

export function uploadVideo({ url, body, mime, name, signal, onProgress }: UploadVideoOptions) {
  return new Promise<{ status: number; data: unknown }>((resolve, reject) => {
    uploadCancelled(signal);
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.open('PUT', url);
    request.timeout = mime === 'video/quicktime' ? 135_000 : 100_000;
    request.withCredentials = true;
    request.responseType = 'json';
    request.setRequestHeader('Content-Type', mime);
    request.setRequestHeader('X-Clip-Name', encodeURIComponent(name.toWellFormed()));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.upload.onload = () => onProgress(1);
    request.onload = () => resolve({ status: request.status, data: request.response });
    request.onerror = () => reject(new Error('Could not connect. Check your connection and try again.'));
    request.ontimeout = () => reject(new Error('The upload took too long. Try again.'));
    request.onabort = () => reject(signal.reason ?? new Error('Upload cancelled.'));
    request.onloadend = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    try {
      request.send(body);
    } catch (error) {
      signal.removeEventListener('abort', abort);
      reject(error);
    }
  });
}
