export const trainingBackupFormat = 'liftmorrow-training';

export function isTrainingBackupFormat(value) {
  // Accept exports made before the rename. New exports always use the current format.
  return value === trainingBackupFormat || value === 'repform-training';
}
