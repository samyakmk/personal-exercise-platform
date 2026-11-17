import type { ReactNode } from 'react';
import type { SelectedVideo } from '../types';

export type CameraRecorderProps = {
  onSelect: (clip: SelectedVideo) => void;
  disabled?: boolean;
  filmingTip?: string;
  selectionLabel?: string;
  alternateAction?: ReactNode;
};

export function CameraRecorder({ alternateAction = null }: CameraRecorderProps) {
  return alternateAction;
}
