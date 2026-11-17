export type VoiceCommands = {
  available: boolean;
  enabled: boolean;
  status: string;
  toggle: () => void;
  stop: () => void;
  setSpeaking: (speaking: boolean) => void;
};

export function useVoiceCommands(_onCommand: (transcript: string) => void): VoiceCommands {
  return { available: false, enabled: false, status: '', toggle() {}, stop() {}, setSpeaking() {} };
}
