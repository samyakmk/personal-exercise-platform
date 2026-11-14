import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { readTrainingSession, writeTrainingSession } from './platform/trainingSession';
import { isSavedTrainingLog } from './trainingProgress';
import type { TrainingSession } from './types';
import { useWorkspace } from './workspace';

const Context = createContext<{
  session: TrainingSession | null;
  keepSession: (value: TrainingSession | null) => void;
} | null>(null);

export function ActiveSessionProvider({ children }: { children: ReactNode }) {
  const { data } = useWorkspace();
  const workspace = data?.workspaceKey;
  const [stored, setStored] = useState<{ workspace?: string; session: TrainingSession | null }>();
  const saved = stored?.workspace === workspace ? stored?.session ?? null : null;
  const session = saved && !data?.workouts.some((workout) => isSavedTrainingLog(saved, workout)) ? saved : null;

  useEffect(() => {
    setStored({ workspace, session: workspace ? readTrainingSession(workspace) : null });
  }, [workspace]);

  const keepSession = useCallback((value: TrainingSession | null) => {
    if (workspace) writeTrainingSession(workspace, value);
    setStored({ workspace, session: value });
  }, [workspace]);

  useEffect(() => {
    if (saved && !session) keepSession(null);
  }, [saved, session, keepSession]);

  return <Context.Provider value={{ session, keepSession }}>{children}</Context.Provider>;
}

export function useActiveSession() {
  const context = useContext(Context);
  if (!context) throw new Error('ActiveSessionProvider is missing');
  return context;
}
