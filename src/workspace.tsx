import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import type { Snapshot, Workspace } from './types';

type WorkspaceState = {
  data: Workspace | null;
  error: string;
  reload: () => void;
  mutate: (operation: () => Promise<Snapshot>) => Promise<void>;
  revision: number;
  notice: string;
  announce: (message: string) => void;
};

const Context = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef<Promise<Workspace> | null>(null);

  const reload = useCallback(() => {
    if (inFlight.current) return;
    setError('');
    const load = api.workspace();
    inFlight.current = load;
    void load.then(setData, (failure: Error) => setError(failure.message))
      .finally(() => { inFlight.current = null; });
  }, []);

  useEffect(reload, [reload]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const mutate = useCallback((operation: () => Promise<Snapshot>) => {
    const update = queue.current.then(async () => {
      const snapshot = await operation();
      setData((current) => current && { ...current, ...snapshot });
      setRevision((value) => value + 1);
    });
    queue.current = update.catch(() => {});
    return update;
  }, []);

  const value = useMemo(() => ({
    data, error, reload, mutate, revision, notice, announce: setNotice,
  }), [data, error, reload, mutate, revision, notice]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error('Workspace provider is missing.');
  return value;
}
