import { useProfiles } from '../profiles';
import { Notice } from './ui';

export function TrainerExerciseCue({ exerciseId }: { exerciseId: string }) {
  const instructions = useProfiles().state?.active?.details.trainingPreferences?.instructions;
  const instruction = instructions?.find((item) => item.exerciseId === exerciseId && item.kind === 'cue');
  return instruction ? <Notice>{`Trainer cue · ${instruction.text}`}</Notice> : null;
}
