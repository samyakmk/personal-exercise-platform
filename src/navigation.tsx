import { useRouter } from 'expo-router';
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

type Intent =
  | { type: 'schedule' }
  | { type: 'edit'; workoutId: string }
  | { type: 'add'; exerciseId: string }
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
      router.navigate(next.type === 'review' ? '/form-review' : '/workouts');
    },
    clear: () => setIntent(null),
  }}>{children}</Context.Provider>;
}

export function useTrainingNavigation() {
  const value = useContext(Context);
  if (!value) throw new Error('Training navigation provider is missing.');
  return value;
}
