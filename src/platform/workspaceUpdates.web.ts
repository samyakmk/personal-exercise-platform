const storageKey = 'repform-workspace-update';
let updateChannel: BroadcastChannel | null = null;

function broadcastChannel() {
  if (updateChannel || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return updateChannel;
  try { updateChannel = new BroadcastChannel(storageKey); }
  catch { /* Some browsers block both forms of cross-tab messaging. */ }
  return updateChannel;
}

export function watchWorkspaceUpdates(refresh: () => void) {
  const channel = broadcastChannel();
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey) refresh();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', onVisibility);
  channel?.addEventListener('message', refresh);
  return () => {
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', onVisibility);
    channel?.removeEventListener('message', refresh);
  };
}

export function signalWorkspaceUpdate() {
  try {
    localStorage.setItem(storageKey, String(Date.now()) + ':' + Math.random());
  } catch {
    // Storage may be disabled while same-origin tabs can still exchange an update.
    broadcastChannel()?.postMessage(null);
  }
}
