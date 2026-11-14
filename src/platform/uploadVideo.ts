import { uploadCancelled } from './uploadVideoTypes';
import type { UploadVideoOptions } from './uploadVideoTypes';

export async function uploadVideo({ url, body, mime, name, signal, onProgress }: UploadVideoOptions) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  uploadCancelled(signal);
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, mime === 'video/quicktime' ? 135_000 : 100_000);
  try {
    const response = await fetch(url, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': mime, 'X-Clip-Name': encodeURIComponent(name.toWellFormed()) },
      body,
      signal: controller.signal,
    });
    onProgress(1);
    const data = await response.json().catch(() => null);
    uploadCancelled(signal);
    return { status: response.status, data };
  } catch (error) {
    uploadCancelled(signal);
    if (controller.signal.aborted) throw new Error('The upload took too long. Try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}
