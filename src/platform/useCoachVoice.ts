export function useCoachVoice(_prompt: string, _setSpeaking: (value: boolean) => void) {
  return { available: false, enabled: false, toggle() {}, say(_text: string) {} };
}
