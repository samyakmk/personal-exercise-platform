import { useEffect, useRef, useState } from 'react';
import { RequestError } from './api';

type RequestState<Result, Input> = {
  key: string; result?: Result; input: Input; pending?: boolean; error?: string; retryAt?: number;
};

export function useRecommendationRequest<Result, Input>(key: string, load: (input: Input, signal: AbortSignal) => Promise<Result>) {
  const [state, setState] = useState<RequestState<Result, Input>>();
  const request = useRef<AbortController | null>(null);
  const current = state?.key === key ? state : undefined;
  const retryAt = current?.retryAt;

  useEffect(() => {
    setState((previous) => previous?.key === key ? previous : undefined);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [key]);

  useEffect(() => {
    if (!retryAt) return;
    const timer = setTimeout(() => {
      setState((current) => current?.key === key && current.retryAt === retryAt ? { ...current, retryAt: undefined } : current);
    }, Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [key, retryAt]);

  async function run(input: Input) {
    if (request.current || retryAt) return;
    const controller = new AbortController();
    request.current = controller;
    setState({ key, result: current?.result, input, pending: true });
    try {
      const result = await load(input, controller.signal);
      if (!controller.signal.aborted) setState({ key, result, input });
    } catch (failure) {
      if (!controller.signal.aborted) {
        const seconds = failure instanceof RequestError ? failure.retryAfter : undefined;
        setState({ key, result: current?.result, input, error: (failure as Error).message,
          retryAt: seconds ? Date.now() + Math.min(300, seconds) * 1000 : undefined });
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  return { ...current, run, retry: () => current && run(current.input) };
}
