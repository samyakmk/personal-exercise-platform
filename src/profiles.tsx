import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { profilesApi, RequestError } from './api';
import { readOfflineProfile, writeOfflineProfile, writeOfflineWorkspace } from './platform/offline';
import { removeTrainingSessionData } from './platform/trainingSession';
import { removeWorkoutDraft } from './platform/workoutDraft';
import { signalWorkspaceUpdate, watchWorkspaceUpdates } from './platform/workspaceUpdates';
import type { ProfileEdit, ProfileSetupInput, ProfileState } from './types';

type ProfilesContext = {
  state: ProfileState | null;
  loadError: string;
  notice: string;
  reload: () => void;
  busy: boolean;
  create: (username: string) => Promise<void>;
  signIn: (username: string) => Promise<void>;
  googleSignIn: (credential: string, nonce: string) => Promise<void>;
  signOut: (key: string) => Promise<void>;
  save: (key: string, details: ProfileEdit) => Promise<void>;
  completeSetup: (key: string, details: ProfileSetupInput) => Promise<void>;
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

  const accept = useCallback((next: ProfileState, deletedKey?: string) => {
    const remaining = new Set(next.profiles.map(({ workspaceKey }) => workspaceKey));
    for (const { workspaceKey } of current.current?.profiles ?? []) {
      if (remaining.has(workspaceKey) || (next.google && deletedKey !== workspaceKey)) continue;
      writeOfflineWorkspace(workspaceKey, null);
      removeTrainingSessionData(workspaceKey);
      removeWorkoutDraft(workspaceKey);
      removeWorkoutDraft(workspaceKey, 'session');
    }
    current.current = next;
    writeOfflineProfile(next);
    setState(next);
    setLoadError('');
  }, []);

  const reload = useCallback(() => {
    if (changing.current) return;
    const request = ++sequence.current;
    void profilesApi.state().then((next) => {
      if (request === sequence.current) accept(next);
    }, (failure: Error) => {
      if (request !== sequence.current) return;
      if (failure instanceof RequestError && [401, 403, 404, 409].includes(failure.status)) {
        current.current = null;
        setState(null);
        writeOfflineProfile(null);
      } else if (!current.current && !(failure instanceof RequestError)) {
        const cached = readOfflineProfile();
        if (cached) {
          current.current = cached;
          setState(cached);
        }
      }
      setLoadError(failure.message);
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

  useEffect(() => {
    const google = state?.google;
    if (!state?.active || !google?.expiresAt) return;
    const { expiresAt, clientId } = google;
    const checkExpiry = () => {
      if (Date.now() < expiresAt || current.current?.google?.expiresAt !== expiresAt) return;
      sequence.current += 1;
      accept({ active: null, profiles: [], canImportLegacy: false, google: { clientId, expiresAt: null } });
      setNotice('Your session expired. Sign in again.');
      reload();
    };
    const timer = setTimeout(checkExpiry, Math.max(0, expiresAt - Date.now()));
    if (typeof window !== 'undefined') window.addEventListener('focus', checkExpiry);
    return () => {
      clearTimeout(timer);
      if (typeof window !== 'undefined') window.removeEventListener('focus', checkExpiry);
    };
  }, [state?.active?.workspaceKey, state?.google?.clientId, state?.google?.expiresAt, accept, reload]);

  async function change(action: () => Promise<ProfileState>, success = '', deletedKey?: string) {
    if (changing.current) return;
    changing.current = true;
    sequence.current += 1;
    setBusy(true);
    setNotice('');
    try {
      accept(await action(), deletedKey);
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
    googleSignIn: (credential, nonce) => change(() => profilesApi.googleSignIn(credential, nonce)),
    signOut: (key) => change(() => profilesApi.signOut(key)),
    save: (key, details) => change(() => profilesApi.save(key, details)),
    completeSetup: (key, details) => change(() => profilesApi.completeSetup(key, details)),
    delete: (key) => change(() => profilesApi.delete(key), 'Account deleted.', key),
  }}>{children}</Context.Provider>;
}

export function useProfiles() {
  const value = useContext(Context);
  if (!value) throw new Error('Profiles provider is missing.');
  return value;
}
