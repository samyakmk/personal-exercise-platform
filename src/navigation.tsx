import { useRouter } from 'expo-router';
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

type Intent =
  | { type: 'schedule' }
  | { type: 'log'; exerciseId?: string }
  | { type: 'edit'; workoutId: string }
  | { type: 'log-plan'; workoutId: string }
  | { type: 'train'; workoutId: string }
  | { type: 'resume' }
  | { type: 'add'; exerciseId: string }
  | { type: 'resume-session' }
  | { type: 'new-session'; exerciseId?: string }
  | { type: 'review'; exerciseId: string };

const Context = createContext<{
  intent: Intent | null;
  open: (intent: Intent) => void;
  clear: () => void;
} | null>(null);

export function TrainingNavigation({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [intent, setIntent] = useState<Intent | null>(null);
  return <Context.Provider value={{
    intent,
    open(next) {
      setIntent(next);
      router.navigate(next.type === 'review' ? '/form-review'
        : next.type === 'resume-session' || next.type === 'new-session' ? '/sessions' : '/workouts');
    },
    clear: () => setIntent(null),
  }}>{children}</Context.Provider>;
}

export function useTrainingNavigation() {
  const value = useContext(Context);
  if (!value) throw new Error('Training navigation provider is missing.');
  return value;
}
