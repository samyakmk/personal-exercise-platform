import type { CheckInState, ProfileState, Workspace } from '../types';

export const readOfflineProfile = (): ProfileState | null => null;
export const writeOfflineProfile = (_state: ProfileState | null) => {};
export const readOfflineWorkspace = (_key: string): Workspace | null => null;
export const writeOfflineWorkspace = (_key: string, _workspace: Workspace | null) => {};
export const readOfflineCheckIn = (_key: string, _day: string): CheckInState | undefined => undefined;
export const writeOfflineCheckIn = (_key: string, _state: CheckInState) => {};
export const registerOfflineShell = () => {};

type Catalog = Required<Pick<Workspace, 'catalog' | 'archivedExercises' | 'catalogVersion'>>;
export const readCachedCatalog = async (_version: string): Promise<Catalog | null> => null;
export const writeCachedCatalog = async (_catalog: Catalog) => {};
