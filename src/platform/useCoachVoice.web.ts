import { useEffect, useRef, useState } from 'react';

function localVoice() {
  return window.speechSynthesis?.getVoices().find((voice) => voice.localService && /^en(?:-|$)/i.test(voice.lang));
}

export function useCoachVoice(prompt: string) {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const spoken = useRef('');

  function say(text: string) {
    const voice = localVoice();
    if (!voice || !text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    spoken.current = text;
  }

  useEffect(() => {
    if (typeof SpeechSynthesisUtterance !== 'function' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    const check = () => setAvailable(Boolean(localVoice()));
    check();
    synth.addEventListener('voiceschanged', check);
    return () => {
      synth.removeEventListener('voiceschanged', check);
      if (spoken.current) synth.cancel();
    };
  }, []);

  useEffect(() => {
    if (enabled && spoken.current !== prompt) say(prompt);
  }, [enabled, prompt]);

  function toggle() {
    if (enabled) {
      window.speechSynthesis.cancel();
      spoken.current = '';
    } else {
      say(prompt);
    }
    setEnabled(!enabled);
  }

  return { available, enabled, toggle };
}
