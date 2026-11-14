import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useLocalClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function update() {
      clearTimeout(timer);
      const current = new Date();
      setNow(current);
      timer = setTimeout(update, 60_000 - (current.getTime() % 60_000));
    }
    update();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') update();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);
  return now;
}
