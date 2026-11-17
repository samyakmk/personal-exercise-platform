import { useCallback, useEffect, useRef, useState } from 'react';

function localVoice() {
  return window.speechSynthesis?.getVoices().find((voice) => voice.localService && /^en(?:-|$)/i.test(voice.lang));
}

export function useCoachVoice(prompt: string, setSpeaking: (value: boolean) => void) {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const active = useRef<SpeechSynthesisUtterance | null>(null);
  const audioOn = useRef(false);

  const say = useCallback((text: string) => {
    const voice = localVoice();
    if (!audioOn.current || !voice || !text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    const previous = active.current;
    active.current = utterance;
    const done = () => {
      if (active.current !== utterance) return;
      active.current = null;
      setSpeaking(false);
    };
    utterance.onend = done;
    utterance.onerror = done;
    setSpeaking(true);
    if (previous) window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [setSpeaking]);

  const silence = useCallback(() => {
    if (!active.current) return;
    active.current = null;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [setSpeaking]);

  useEffect(() => {
    if (typeof SpeechSynthesisUtterance !== 'function' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    const check = () => setAvailable(Boolean(localVoice()));
    check();
    synth.addEventListener('voiceschanged', check);
    return () => {
      synth.removeEventListener('voiceschanged', check);
      silence();
    };
  }, [silence]);

  useEffect(() => {
    if (enabled) say(prompt);
  }, [enabled, prompt, say]);

  function toggle() {
    audioOn.current = !audioOn.current;
    if (!audioOn.current) silence();
    setEnabled(audioOn.current);
  }

  return { available, enabled, toggle, say };
}
