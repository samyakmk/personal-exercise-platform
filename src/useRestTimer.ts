import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useRestTimer(savedDeadline?: number | null, onChange?: (deadline: number | null) => void) {
  const [localDeadline, setLocalDeadline] = useState<number | null>(null);
  const deadline = savedDeadline === undefined ? localDeadline : savedDeadline;
  const setDeadline = onChange ?? setLocalDeadline;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    let timer: ReturnType<typeof setTimeout>;
    function tick() {
      clearTimeout(timer);
      const time = Date.now();
      setNow(time);
      if (deadline !== null && time < deadline) {
        const remaining = deadline - time;
        timer = setTimeout(tick, remaining % 1000 || 1000);
      }
    }
    tick();
    const state = AppState.addEventListener('change', (status) => { if (status === 'active') tick(); });
    return () => { clearTimeout(timer); state.remove(); };
  }, [deadline]);

  return {
    active: deadline !== null,
    seconds: deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000)),
    remaining() { return deadline === null ? 0 : Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); },
    start(duration: number) {
      const time = Date.now();
      setNow(time);
      setDeadline(time + duration * 1000);
    },
    clear() { setDeadline(null); },
  };
}
