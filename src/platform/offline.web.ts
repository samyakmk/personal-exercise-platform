import type { CheckInState, ProfileState, Workspace } from '../types';

const prefix = 'trainer-plus-offline-v1:';

function read<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(prefix + key) ?? 'null'); }
  catch { return null; }
}

function write(key: string, data: unknown) {
  try {
    if (data === null) localStorage.removeItem(prefix + key);
    else localStorage.setItem(prefix + key, JSON.stringify(data));
  } catch { /* Resume can still use the live workspace when offline storage is unavailable. */ }
}

export function readOfflineProfile() {
  const state = read<ProfileState>('profile');
  return state?.active?.workspaceKey ? state : null;
}

export function writeOfflineProfile(state: ProfileState | null) {
  const previous = readOfflineProfile();
  const active = state?.active;
  if (previous?.active && previous.active.workspaceKey !== active?.workspaceKey) {
    writeOfflineWorkspace(previous.active.workspaceKey, null);
  }
  write('profile', active ? {
    active, canImportLegacy: false, profiles: [{ username: active.username, workspaceKey: active.workspaceKey }],
  } : null);
}

export function readOfflineWorkspace(key: string) {
  const workspace = read<Workspace>('workspace:' + key);
  return workspace?.workspaceKey === key ? workspace : null;
}

export function writeOfflineWorkspace(key: string, workspace: Workspace | null) {
  if (!workspace) {
    write('workspace:' + key, null);
    write('check-in:' + key, null);
    return;
  }
  const workouts = workspace.workouts.filter(({ status }) => status === 'planned').slice(0, 40)
    .concat(workspace.workouts.filter(({ status }) => status === 'completed').slice(-40));
  workouts.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  write('workspace:' + key, { ...workspace, aiAvailable: false, workouts, clips: [] });
}

export function readOfflineCheckIn(key: string, day: string) {
  const state = read<CheckInState>('check-in:' + key);
  return state?.day === day ? state : undefined;
}

export function writeOfflineCheckIn(key: string, state: CheckInState) {
  write('check-in:' + key, { day: state.day, adjustment: state.adjustment, entries: [] });
}

type Catalog = Required<Pick<Workspace, 'catalog' | 'archivedExercises' | 'catalogVersion'>>;
const cacheName = 'trainer-plus-exercise-catalog-v1';
const catalogUrl = () => new URL('/api/exercise-catalog', location.origin).href;

export async function readCachedCatalog(version: string): Promise<Catalog | null> {
  try {
    const cache = await caches.open(cacheName);
    const entry = await cache.match(catalogUrl());
    const catalog = await entry?.json() as Catalog | undefined;
    return catalog?.catalogVersion === version && Array.isArray(catalog.catalog) && Array.isArray(catalog.archivedExercises) ? catalog : null;
  } catch { return null; }
}

export async function writeCachedCatalog(catalog: Catalog) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(catalogUrl(), new Response(JSON.stringify(catalog), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* The live catalog does not depend on a browser cache. */ }
}

export function registerOfflineShell() {
  if (__DEV__ || process.env.EXPO_PUBLIC_API_ORIGIN || !navigator.serviceWorker) return;
  void navigator.serviceWorker.register('/trainer-plus-offline.js').catch(() => {});
}
