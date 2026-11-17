import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VoiceCommands } from './useVoiceCommands';

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  start(): void;
  abort(): void;
};

function microphoneError(error: string) {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Voice commands need microphone and speech recognition permission in your browser.';
    case 'audio-capture':
      return 'No microphone is available. Connect one and try again.';
    case 'network':
      return 'The browser’s speech service is unavailable. Check your connection and try again.';
    default:
      return 'Voice commands couldn’t start. Try again or use the session controls.';
  }
}

export function useVoiceCommands(onCommand: (transcript: string) => void): VoiceCommands {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('');
  const command = useRef(onCommand);
  const speaking = useRef(false);
  const controls = useRef<{ toggle: () => void; stop: () => void; sync: () => void }>(null);
  useLayoutEffect(() => { command.current = onCommand; }, [onCommand]);

  useEffect(() => {
    const browser = window as Window & {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const Recognizer = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!window.isSecureContext || !Recognizer) return;
    const Recognition = Recognizer;
    setAvailable(true);

    let enabled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let current: { recognition: Recognition; interrupted: boolean } | undefined;
    const paused = () => speaking.current || document.hidden;

    function interrupt() {
      clearTimeout(retry);
      retry = undefined;
      if (current && !current.interrupted) {
        current.interrupted = true;
        current.recognition.abort();
      }
    }

    function stop(message = '') {
      enabled = false;
      setEnabled(false);
      setStatus(message);
      interrupt();
    }

    function start() {
      if (!enabled || paused() || current) return;
      let started = false;
      let nextResult = 0;
      try {
        const recognition = new Recognition();
        const run = { recognition, interrupted: false };
        current = run;
        recognition.lang = 'en-US';
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.onstart = () => {
          started = true;
          if (enabled && current === run && !run.interrupted) setStatus('Listening for commands');
        };
        recognition.onresult = ({ resultIndex, results }) => {
          if (!enabled || paused() || current !== run || run.interrupted) return;
          const result = results[Math.max(nextResult, resultIndex)];
          if (result?.isFinal) {
            // Handle one utterance per event so a batch cannot cross several workout steps.
            nextResult = results.length;
            command.current(result[0].transcript);
          }
        };
        recognition.onerror = ({ error }) => {
          if (current !== run || run.interrupted) return;
          if (error === 'no-speech') started = true;
          else stop(microphoneError(error));
        };
        recognition.onend = () => {
          if (current !== run) return;
          current = undefined;
          if (!enabled || paused()) return;
          if (!started && !run.interrupted) {
            stop(microphoneError(''));
            return;
          }
          setStatus('Reconnecting microphone…');
          retry = setTimeout(() => {
            retry = undefined;
            start();
          }, 300);
        };
        setStatus('Starting microphone…');
        recognition.start();
      } catch {
        current = undefined;
        stop(microphoneError(''));
      }
    }

    function sync() {
      if (!enabled) return;
      if (paused()) {
        interrupt();
        setStatus(document.hidden ? 'Microphone paused while the tab is hidden' : 'Microphone paused while the coach speaks');
      } else if (!retry) {
        if (current?.interrupted) setStatus('Reconnecting microphone…');
        start();
      }
    }

    controls.current = {
      toggle() {
        if (enabled) stop();
        else {
          enabled = true;
          setEnabled(true);
          sync();
        }
      },
      stop,
      sync,
    };
    document.addEventListener('visibilitychange', sync);
    return () => {
      enabled = false;
      controls.current = null;
      document.removeEventListener('visibilitychange', sync);
      interrupt();
      current = undefined;
    };
  }, []);

  const setSpeaking = useCallback((value: boolean) => {
    speaking.current = value;
    controls.current?.sync();
  }, []);
  return { available, enabled, status, setSpeaking, toggle: () => controls.current?.toggle(),
    stop: () => controls.current?.stop() };
}
