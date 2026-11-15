type Topic = 'workspace' | 'profile' | 'companion';

export function watchWorkspaceUpdates(_refresh: () => void, _topic?: Topic) {
  return () => {};
}

export function signalWorkspaceUpdate(_topic?: Topic) {}
