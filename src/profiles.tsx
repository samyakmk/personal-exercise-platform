import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { profilesApi } from './api';
import { writeTrainingSession } from './platform/trainingSession';
import { removeWorkoutDraft } from './platform/workoutDraft';
import { signalWorkspaceUpdate, watchWorkspaceUpdates } from './platform/workspaceUpdates';
import type { ProfileEdit, ProfileState } from './types';

type ProfilesContext = {
  state: ProfileState | null;
  loadError: string;
  notice: string;
  reload: () => void;
  busy: boolean;
  create: (username: string) => Promise<void>;
  signIn: (username: string) => Promise<void>;
  signOut: (key: string) => Promise<void>;
  save: (key: string, details: ProfileEdit) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

const Context = createContext<ProfilesContext | null>(null);

export function ProfilesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProfileState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const current = useRef<ProfileState | null>(null);
  const changing = useRef(false);
  const sequence = useRef(0);

  const accept = useCallback((next: ProfileState) => {
    const remaining = new Set(next.profiles.map(({ workspaceKey }) => workspaceKey));
    for (const { workspaceKey } of current.current?.profiles ?? []) {
      if (remaining.has(workspaceKey)) continue;
      writeTrainingSession(workspaceKey, null);
      removeWorkoutDraft(workspaceKey);
      removeWorkoutDraft(workspaceKey, 'session');
    }
    current.current = next;
    setState(next);
    setLoadError('');
  }, []);

  const reload = useCallback(() => {
    if (changing.current) return;
    const request = ++sequence.current;
    void profilesApi.state().then((next) => {
      if (request === sequence.current) accept(next);
    }, (failure: Error) => {
      if (request === sequence.current) setLoadError(failure.message);
    });
  }, [accept]);

  useEffect(() => {
    reload();
    const unwatch = watchWorkspaceUpdates(reload, 'profile');
    return () => {
      sequence.current += 1;
      unwatch();
    };
  }, [reload]);

  async function change(action: () => Promise<ProfileState>, success = '') {
    if (changing.current) return;
    changing.current = true;
    sequence.current += 1;
    setBusy(true);
    setNotice('');
    try {
      accept(await action());
      setNotice(success);
      signalWorkspaceUpdate('profile');
    } finally {
      changing.current = false;
      setBusy(false);
      // Reconcile with the browser's current selection if another tab changed it
      // during this request, or the server saved the change before a timeout.
      reload();
    }
  }

  return <Context.Provider value={{
    state, loadError, notice, reload, busy,
    create: (username) => change(() => profilesApi.create(username)),
    signIn: (username) => change(() => profilesApi.signIn(username)),
    signOut: (key) => change(() => profilesApi.signOut(key)),
    save: (key, details) => change(() => profilesApi.save(key, details)),
    delete: (key) => change(() => profilesApi.delete(key), 'Account deleted.'),
  }}>{children}</Context.Provider>;
}

export function useProfiles() {
  const value = useContext(Context);
  if (!value) throw new Error('Profiles provider is missing.');
  return value;
}
