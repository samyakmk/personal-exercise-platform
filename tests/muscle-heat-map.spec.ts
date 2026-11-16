import { createBrowserProfile, expect, test } from './signed-in';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { muscleNames } from '../src/muscleWork';
import type { Exercise, Workout } from '../src/types';

async function seedWorkout(page: Page, fields: Pick<Workout, 'name' | 'date' | 'exercises'> & Partial<Workout>) {
  const id = randomUUID();
  const response = await page.request.post('/api/workouts', { data: {
    id, time: '10:00', status: 'completed', ...fields,
  } });
  expect(response.ok()).toBeTruthy();
  return id;
}

test('the heat map weights logged sets across the selected period and shows an individual session', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 10, 14, 12));
  await page.goto('/progress');
  await expect(page.getByText('No logged sets in this view.', { exact: false })).toBeVisible();
  const upper = await seedWorkout(page, { name: 'Upper body', date: '2026-11-14', exercises: [
    { exerciseId: 'pull-up', sets: 3, reps: 8 },
    { exerciseId: 'dumbbell-shoulder-press', sets: 2, setDetails: [{ reps: 10 }, { load: { unit: 'kg', value: 8 } }] },
    { exerciseId: 'bodyweight-squat', sets: 0, setDetails: [] },
  ] });
  await seedWorkout(page, { name: 'At the weekly boundary', date: '2026-11-08',
    exercises: [{ exerciseId: 'pull-up', sets: 2, reps: 6 }] });
  await seedWorkout(page, { name: 'Earlier lower body', date: '2026-11-07',
    exercises: [{ exerciseId: 'bodyweight-squat', sets: 1, reps: 12 }] });
  await seedWorkout(page, { name: 'Older lower body', date: '2026-10-15',
    exercises: [{ exerciseId: 'bodyweight-squat', sets: 12, reps: 12 }] });
  await seedWorkout(page, { name: 'Planned lower body', date: '2026-11-13', status: 'planned',
    exercises: [{ exerciseId: 'bodyweight-squat', sets: 10, reps: 12 }] });
  const future = await seedWorkout(page, { name: 'Future completed entry', date: '2026-11-14', time: '19:00',
    exercises: [{ exerciseId: 'bodyweight-squat', sets: 10, reps: 12 }] });
  await page.reload();
  const map = page.getByRole('group', { name: 'Muscle heat map', exact: true });
  const muscle = (name: string, points: number) =>
    map.getByRole('link', { name: `${name}, ${points} ${points === 1 ? 'point' : 'points'} · Find exercises` });

  await expect(muscle('Lats', 5.3)).toBeVisible();
  await expect(muscle('Shoulders', 4.9)).toBeVisible();
  await expect(muscle('Biceps', 2.6)).toBeVisible();
  await expect(muscle('Triceps', 1)).toBeVisible();
  await map.getByRole('button', { name: 'Show all muscles' }).click();
  await expect(map.getByRole('listitem')).toHaveCount(muscleNames.length);
  await expect(muscle('Quadriceps', 0)).toBeVisible();
  const workspace = await page.request.get('/api/workspace');
  const { catalog }: { catalog: Exercise[] } = await workspace.json();
  const catalogMuscles = new Set(catalog.flatMap(({ primaryMuscles, secondaryMuscles }) =>
    [...(primaryMuscles ?? []), ...(secondaryMuscles ?? [])]));
  expect(new Set(await map.locator('path[data-muscle]').evaluateAll((paths) =>
    paths.map((path) => path.getAttribute('data-muscle'))))).toEqual(catalogMuscles);
  const quads = map.locator('path[data-muscle="Quadriceps"]').first();
  const unworked = await quads.getAttribute('fill');
  await expect(map.locator('path[data-muscle="Lats"]').first()).not.toHaveAttribute('fill', unworked!);

  await page.getByRole('button', { name: 'Past 30 days' }).click();
  await expect(muscle('Quadriceps', 1)).toBeVisible();
  await expect(muscle('Lats', 5.3)).toBeVisible();
  await expect(quads).not.toHaveAttribute('fill', unworked!);

  await page.goto('/progress?session=' + future);
  await expect(page.getByText('The requested session is no longer available.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'This session' })).toHaveCount(0);

  await page.goto('/workouts?view=history');
  await page.getByRole('button', { name: 'Details · Upper body' }).click();
  await expect(page.getByRole('link', { name: 'Muscle heat map' })).toHaveAttribute('href', '/progress?session=' + upper);

  await page.goto('/sessions?session=' + upper);
  await page.getByRole('link', { name: 'Muscle heat map' }).click();
  await expect(page).toHaveURL(/\/progress\?session=/);
  await expect(page.getByRole('button', { name: 'This session' })).toHaveAttribute('aria-pressed', 'true');
  await expect(muscle('Lats', 3.2)).toBeVisible();
  await expect(muscle('Biceps', 1.6)).toBeVisible();
  const triceps = muscle('Triceps', 1);
  await triceps.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/explore\?detail=Triceps/);
  await expect(page.getByRole('button', { name: 'Clear Triceps filter' })).toBeVisible();
  const search = page.getByRole('textbox', { name: 'Search exercises' });
  await search.fill('standing dumbbell shoulder press');
  await expect(page.getByRole('button', { name: /Standing Dumbbell Shoulder Press/ })).toBeVisible();
  await search.fill('single arm dumbbell curl');
  await expect(page.getByRole('heading', { name: 'No matching exercises' })).toBeVisible();
  await page.getByRole('button', { name: 'All muscles' }).click();
  await expect(page.getByRole('button', { name: 'Clear Triceps filter' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Single-Arm Dumbbell Curl/ })).toBeVisible();
});

test('the muscle diagram opens filtered exercises on a narrow touch screen', async ({ browser, baseURL }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await createBrowserProfile(page.request, baseURL!);
    await page.goto('/progress');
    const map = page.getByRole('group', { name: 'Muscle heat map', exact: true });
    await expect(map.getByRole('group', { name: 'Body model' })).toHaveCount(0);
    const biceps = map.locator('path[data-muscle="Biceps"]').first();
    await expect(biceps).toBeVisible();
    const mapBounds = await map.boundingBox();
    expect(mapBounds!.x + mapBounds!.width).toBeLessThanOrEqual(390);
    await biceps.tap();
    await expect(page.getByRole('button', { name: 'Clear Biceps filter' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Single-Arm Dumbbell Curl/ })).toBeVisible();
  } finally {
    await page.close();
  }
});
