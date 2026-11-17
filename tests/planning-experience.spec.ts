import { randomUUID } from 'node:crypto';
import { expect, test } from './signed-in';

test('a lighter check-in adjusts a scheduled session before it starts', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 10, 18, 12));
  const id = randomUUID();
  const stored = await page.request.post('/api/workouts', { data: {
    id, date: '2026-11-18', time: '17:00', name: 'Trainer practice', status: 'planned',
    exercises: [{ exerciseId: 'goblet-squat', sets: 3, reps: 8, load: { value: 20, unit: 'lb' } }],
  } });
  expect(stored.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Training check-in' }).click();
  const checkIn = page.getByRole('dialog', { name: 'Training check-in' });
  await checkIn.getByRole('button', { name: 'Go lighter' }).click();
  await checkIn.getByRole('button', { name: 'Save without reply' }).click();
  await expect(checkIn.getByText('Check-in saved privately.')).toBeVisible();
  await checkIn.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Workout details' }).click();
  await expect(page.getByText('2 × 7 reps', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start lighter version' }).click();
  const session = page.getByRole('dialog', { name: 'Trainer practice' });
  await session.getByRole('button', { name: 'I’m ready' }).click();
  await expect(session.getByRole('textbox', { name: 'Reps · Goblet Squat' })).toHaveValue('7');
  await expect(session.getByRole('textbox', { name: 'Weight per dumbbell · Goblet Squat' })).toHaveValue('');
  const { workouts } = await (await page.request.get('/api/workspace')).json();
  expect(workouts[0]).toMatchObject({ id, status: 'planned', exercises: [{ sets: 3, reps: 8, load: { value: 20 } }] });
});

test('a scheduled suggestion uses its setup values without changing profile equipment', async ({ page }) => {
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Schedule workout' }).click();
  const editor = page.getByRole('dialog', { name: 'Schedule a workout' });
  await editor.getByLabel('Date', { exact: true }).fill('2027-06-14');
  await editor.getByLabel('Time', { exact: true }).fill('09:00');
  await editor.getByLabel('Time available').selectOption('10');
  await editor.getByRole('button', { name: 'Equipment for this workout' }).click();
  const gear = page.getByRole('dialog', { name: 'Equipment for this session' });
  await gear.getByRole('button', { name: 'Bodyweight only' }).click();
  await gear.getByRole('button', { name: 'Use this equipment' }).click();
  const generated = page.waitForResponse((response) => response.url().includes('/api/workouts/recommendation?'));
  await editor.getByRole('button', { name: 'Suggest a workout' }).click();
  const response = await generated;
  expect(response.ok()).toBe(true);
  const query = new URL(response.url()).searchParams;
  expect(Object.fromEntries(query)).toMatchObject({ date: '2027-06-14', time: '09:00', minutes: '10', gearOverride: '1' });
  await expect(editor.getByRole('list', { name: 'Suggested exercises' })).toBeVisible();
  await editor.getByRole('button', { name: 'Use this workout' }).click();
  await expect(editor.getByLabel('Date', { exact: true })).toHaveValue('2027-06-14');
  const workspace = await (await page.request.get('/api/workspace')).json();
  expect(workspace.equipment).toBeNull();
});

test('series changes apply to remaining occurrences and a single skip leaves the rest', async ({ page }) => {
  const id = randomUUID();
  const stored = await page.request.post('/api/workouts', { data: {
    id, date: '2027-06-14', time: '17:00', name: 'Weekly practice', status: 'planned', repeatWeeks: 3,
    exercises: [{ exerciseId: 'bodyweight-squat', sets: 3, reps: 8 }],
  } });
  expect(stored.ok()).toBe(true);
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Edit workout · Weekly practice' }).first().click();
  const edit = page.getByRole('dialog', { name: 'Edit workout' });
  await edit.getByLabel('Apply changes to').selectOption('future');
  await edit.getByLabel('Date', { exact: true }).fill('2027-06-15');
  await edit.getByRole('button', { name: 'Save series changes' }).click();
  await expect(edit).toBeHidden();
  await page.getByRole('button', { name: 'Skip occurrence · Weekly practice' }).nth(1).click();
  const skip = page.getByRole('dialog', { name: 'Skip this occurrence?' });
  await skip.getByRole('button', { name: 'Skip this occurrence' }).click();
  await expect(skip).toBeHidden();
  const { workouts } = await (await page.request.get('/api/workspace')).json();
  expect(workouts.map(({ date, seriesId, seriesIndex }) => [date, seriesId, seriesIndex])).toEqual([
    ['2027-06-15', id, 0], ['2027-06-29', id, 2],
  ]);
});
