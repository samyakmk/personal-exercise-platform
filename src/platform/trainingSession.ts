import type { PendingTrainingLog, TrainingSession } from '../types';

export function readTrainingSession(_workspace: string): TrainingSession | null { return null; }
export function writeTrainingSession(_workspace: string, _session: TrainingSession | null) { return false; }
export function readPendingTrainingLogs(_workspace: string): PendingTrainingLog[] { return []; }
export function writePendingTrainingLog(_workspace: string, _pending: PendingTrainingLog) { return false; }
export function removePendingTrainingLog(_workspace: string, _logId: string) {}
export function removeTrainingSessionData(_workspace: string) {}
export function watchTrainingSession(_workspace: string, _onSession: () => void, _onQueue: () => void, _onOnline: () => void) { return () => {}; }
export function trainingServerMayBeReachable() { return true; }
