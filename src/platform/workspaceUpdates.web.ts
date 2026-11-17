type Topic = 'workspace' | 'profile' | 'companion';

const channels = new Map<string, BroadcastChannel>();
// Older tabs still use this channel to detect profile and workspace changes.
const keyFor = (topic: Topic) => 'liftmorrow-' + topic + '-update';

function broadcastChannel(key: string) {
  if (channels.has(key) || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return channels.get(key);
  try { channels.set(key, new BroadcastChannel(key)); }
  catch { /* Some browsers block both forms of cross-tab messaging. */ }
  return channels.get(key);
}

export function watchWorkspaceUpdates(refresh: () => void, topic: Topic = 'workspace') {
  const key = keyFor(topic);
  const channel = broadcastChannel(key);
  const onStorage = (event: StorageEvent) => {
    if (event.key === key) refresh();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('pageshow', refresh);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', onVisibility);
  channel?.addEventListener('message', refresh);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('pageshow', refresh);
    window.removeEventListener('online', refresh);
    document.removeEventListener('visibilitychange', onVisibility);
    channel?.removeEventListener('message', refresh);
  };
}

export function signalWorkspaceUpdate(topic: Topic = 'workspace') {
  const key = keyFor(topic);
  try {
    localStorage.setItem(key, String(Date.now()) + ':' + Math.random());
  } catch {
    // Storage may be disabled while same-origin tabs can still exchange an update.
    broadcastChannel(key)?.postMessage(null);
  }
}
