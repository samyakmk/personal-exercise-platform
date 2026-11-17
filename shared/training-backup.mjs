export const trainingBackupFormat = 'trainer-plus-training';

export function isTrainingBackupFormat(value) {
  // Accept exports made before the rename. New exports always use the current format.
  return value === trainingBackupFormat || value === 'liftmorrow-training' || value === 'repform-training';
}
