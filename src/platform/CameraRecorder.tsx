import type { SelectedVideo } from '../types';

export type CameraRecorderProps = {
  onSelect: (clip: SelectedVideo) => void;
  disabled?: boolean;
  filmingTip?: string;
  selectionLabel?: string;
};

export function CameraRecorder(_props: CameraRecorderProps) {
  return null;
}
