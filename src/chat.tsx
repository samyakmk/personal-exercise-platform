import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createId, RequestError } from './api';
import type { ChatAnswer, ChatMessage } from './types';
import { useWorkspace } from './workspace';

type Turn = { id: string; message: string };
type CompletedTurn = Turn & { answer: ChatAnswer };
type PendingTurn = Turn & { error?: string };
const Context = createContext<{
  turns: CompletedTurn[];
  pending: PendingTurn | null;
  send: (message: string) => boolean;
  retry: () => void;
  reset: () => void;
} | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { api, reload } = useWorkspace();
  const [turns, setTurns] = useState<CompletedTurn[]>([]);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  function request(turn: Turn) {
    if (active.current) return false;
    const controller = new AbortController();
    active.current = controller;
    setPending({ id: turn.id, message: turn.message });
    const history = turns.slice(-4).flatMap(({ message, answer }): ChatMessage[] =>
      [{ role: 'user', text: message }, { role: 'assistant', text: answer.reply }]);
    void api.chat(turn.message, history, controller.signal).then((answer) => {
      if (controller.signal.aborted) return;
      setTurns((previous) => [...previous, { ...turn, answer }]);
      setPending(null);
    }).catch((error: Error) => {
      if (controller.signal.aborted) return;
      if (error instanceof RequestError && [404, 409].includes(error.status)) reload();
      setPending({ ...turn, error: error.message });
    }).finally(() => {
      if (active.current === controller) active.current = null;
    });
    return true;
  }

  return <Context.Provider value={{
    turns, pending,
    send: (message) => Boolean(message.trim()) && request({ id: createId(), message: message.trim() }),
    retry: () => { if (pending?.error) request(pending); },
    reset: () => {
      active.current?.abort();
      active.current = null;
      setTurns([]);
      setPending(null);
    },
  }}>{children}</Context.Provider>;
}

export function useTrainingChat() {
  const context = useContext(Context);
  if (!context) throw new Error('Chat provider is missing.');
  return context;
}
