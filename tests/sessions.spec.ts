import { randomUUID } from 'node:crypto';
import { expect, test } from './signed-in';
import { chooseExercise } from './exercise-picker';

test('an exercise removed from the library remains editable in restored training history', async ({ page }) => {
  const id = randomUUID();
  const restored = await page.request.post('/api/workspace/training-backup', { data: {
    format: 'repform-training', version: 1, equipment: null,
    workouts: [{ id, name: 'Earlier mobility session', date: '2026-10-20', time: '18:00', status: 'completed',
      exercises: [{ exerciseId: 'fedb-all-fours-quad-stretch', sets: 1, reps: 20 }] }],
  } });
  expect(restored.ok(), await restored.text()).toBe(true);
  await page.goto(`/sessions?session=${id}`);
  const sets = page.getByRole('list', { name: 'Sets for All Fours Quad Stretch' });
  await expect(sets).toContainText('20 sec');
  await page.getByRole('button', { name: 'Edit session' }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Seconds · Set 1 · All Fours Quad Stretch').fill('25');
  await editor.getByRole('combobox', { name: 'Choose an exercise' }).fill('All Fours Quad Stretch');
  await expect(editor.getByRole('status')).toHaveText('No matching exercises');
  await editor.getByRole('button', { name: 'Save session', exact: true }).click();
  await expect(sets).toContainText('25 sec');
  await page.goto('/progress?exercise=fedb-all-fours-quad-stretch');
  await expect(page.getByRole('combobox', { name: 'Exercise history' })).toHaveValue('All Fours Quad Stretch');
  await expect(page.getByText('Earlier mobility session', { exact: true })).toBeVisible();
});

test('manual sessions preserve individual sets, and edits and deletion update the journal', async ({ page }) => {
  await page.goto('/sessions');
  await expect(page.getByRole('heading', { name: 'No sessions logged yet' })).toBeVisible();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Session name').fill('Evening strength');
  await expect(editor.getByLabel('Choose an exercise')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Save and continue' }).click();
  await chooseExercise(editor, 'Choose an exercise', 'Goblet Squat');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(editor.getByLabel('Reps · Set 1 · Goblet Squat', { exact: true })).toHaveValue('');
  await editor.getByLabel('Reps · Set 1 · Goblet Squat', { exact: true }).fill('12');
  await editor.getByLabel('Weight per dumbbell · Set 1 · Goblet Squat').fill('25');
  await editor.getByRole('button', { name: 'Add set · Goblet Squat' }).click();
  await editor.getByLabel('Reps · Set 2 · Goblet Squat', { exact: true }).fill('8');
  await editor.getByLabel('Weight per dumbbell · Set 2 · Goblet Squat').fill('15');
  await editor.getByLabel('Unit · Set 2 · Goblet Squat').selectOption('kg');
  await chooseExercise(editor, 'Choose an exercise', 'Forearm Plank');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await editor.getByLabel('Seconds · Set 1 · Forearm Plank').fill('40');
  await page.reload();
  await page.getByRole('button', { name: 'Resume session draft' }).click();
  await expect(editor.getByLabel('Reps · Set 2 · Goblet Squat', { exact: true })).toHaveValue('8');
  await editor.getByRole('button', { name: 'Save exercises', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Evening strength' })).toBeVisible();
  const sets = page.getByRole('list', { name: 'Sets for Goblet Squat' });
  await expect(sets.getByRole('listitem')).toHaveCount(2);
  await expect(sets).toContainText('12 reps · 25 lb per dumbbell');
  await expect(sets).toContainText('8 reps · 15 kg per dumbbell');
  await expect(page.getByRole('list', { name: 'Sets for Forearm Plank' })).toContainText('40 sec');

  await page.reload();
  await page.getByRole('textbox', { name: 'Search sessions' }).fill('plank');
  await expect(page.getByRole('heading', { name: 'Evening strength' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit session' }).click();
  await editor.getByLabel('Session name').fill('Evening strength revised');
  await editor.getByLabel('Reps · Set 2 · Goblet Squat', { exact: true }).fill('9');
  await editor.getByRole('button', { name: 'Save session', exact: true }).click();
  await expect(sets).toContainText('9 reps · 15 kg per dumbbell');
  await page.getByRole('link', { name: 'Progress', exact: true }).click();
  await expect(page.getByText('Evening strength revised', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Edit session' }).click();
  await editor.getByRole('button', { name: 'Delete session', exact: true }).click();
  await editor.getByRole('button', { name: 'Keep session' }).click();
  await expect(editor.getByLabel('Session name')).toHaveValue('Evening strength revised');
  await editor.getByRole('button', { name: 'Delete session', exact: true }).click();
  await editor.getByRole('button', { name: 'Delete session', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No sessions logged yet' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No sessions logged yet' })).toBeVisible();
});

test('exercise details use the same session flow and suggest an exercise after creation', async ({ page }) => {
  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/explore?exercise=push-up');
  await page.getByRole('dialog', { name: 'Push-Up', exact: true }).getByRole('button', { name: 'New session' }).click();
  const setup = page.getByRole('dialog', { name: 'New session' });
  await expect(setup.getByLabel('Session name')).toHaveValue('Push-Up session');
  await setup.getByLabel('Session name').fill('Quick training');
  await setup.getByLabel('Date').fill('2026-10-20');
  await setup.getByLabel('Time').fill('17:45');
  await expect(setup.getByLabel('Choose an exercise')).toHaveCount(0);
  await setup.getByRole('button', { name: 'Save and continue' }).click();
  const editor = page.getByRole('dialog', { name: 'Session exercises' });
  await expect(editor.getByLabel('Reps · Set 1 · Push-Up', { exact: true })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await editor.getByLabel('Reps · Set 1 · Push-Up', { exact: true }).fill('7');
  await editor.getByRole('button', { name: 'Save exercises' }).click();
  await expect(page.getByRole('list', { name: 'Sets for Push-Up' })).toContainText('7 reps');
  const { workouts } = await (await page.request.get('/api/workspace')).json();
  expect(workouts).toHaveLength(1);
  expect(workouts[0]).toMatchObject({ name: 'Quick training', date: '2026-10-20', time: '17:45', status: 'completed', exercises: [
    { exerciseId: 'push-up', setDetails: [{ reps: 7 }] },
  ] });
  await page.getByRole('button', { name: 'Train again' }).click();
  const active = page.getByRole('dialog', { name: 'Quick training' });
  await expect(active.getByLabel('Reps · Push-Up', { exact: true })).toHaveValue('7');
  await active.getByRole('button', { name: 'Pause session' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Resume session', exact: true }).click();
  await expect(active.getByRole('button', { name: 'Finish session' })).toBeDisabled();
});

test('a metadata-only session can be saved and filled in later on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/sessions');
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Session name').fill('Chest and core');
  await editor.getByLabel('Date').fill('2026-11-12');
  await editor.getByLabel('Time').fill('08:30');
  await editor.getByLabel('Session notes').fill('Morning session');
  await editor.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Session exercises' })).toBeVisible();
  const { workouts } = await (await page.request.get('/api/workspace')).json();
  expect(workouts).toHaveLength(1);
  expect(workouts[0]).toMatchObject({ name: 'Chest and core', date: '2026-11-12', time: '08:30', notes: 'Morning session', exercises: [] });
  await editor.getByRole('button', { name: 'Add later' }).click();
  await expect(page.getByRole('heading', { name: 'Chest and core' })).toBeVisible();

  await page.reload();
  await expect(page.getByText('No exercises added yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Add exercises' }).click();
  await expect(editor.getByLabel('Date')).toHaveCount(0);
  await chooseExercise(editor, 'Choose an exercise', 'Dumbbell Bench Press');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  const addSet = editor.getByRole('button', { name: 'Add set · Dumbbell Bench Press' });
  await editor.getByLabel('Reps · Set 1 · Dumbbell Bench Press', { exact: true }).fill('12');
  await editor.getByLabel('Weight per dumbbell · Set 1 · Dumbbell Bench Press').fill('20');
  await addSet.click();
  await addSet.click();
  await editor.getByLabel('Reps · Set 3 · Dumbbell Bench Press', { exact: true }).fill('15');
  await editor.getByLabel('Weight per dumbbell · Set 3 · Dumbbell Bench Press').fill('15');
  await addSet.click();
  await editor.getByLabel('Reps · Set 4 · Dumbbell Bench Press', { exact: true }).fill('');
  await chooseExercise(editor, 'Choose an exercise', 'Forearm Plank');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await editor.getByRole('button', { name: 'Save exercises', exact: true }).click();

  const sets = page.getByRole('list', { name: 'Sets for Dumbbell Bench Press' }).getByRole('listitem');
  await expect(sets).toHaveText([
    /Set 1.*12 reps · 20 lb per dumbbell/s,
    /Set 2.*12 reps · 20 lb per dumbbell/s,
    /Set 3.*15 reps · 15 lb per dumbbell/s,
    /Set 4.*15 lb per dumbbell/s,
  ]);
  await expect(sets.nth(3)).not.toContainText('reps');
  await expect(page.getByText('No sets recorded.')).toBeVisible();
  await expect(page.getByText('Morning session')).toBeVisible();
});


test('retrying metadata save after a lost response opens the same session', async ({ page }) => {
  await page.goto('/sessions');
  await expect(page.getByRole('button', { name: 'Start session', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Log session', exact: true })).toHaveCount(0);
  await page.route('**/api/workouts?response=delta', async (route) => {
    expect(route.request().method()).toBe('POST');
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    await route.abort('failed');
  }, { times: 1 });
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'New session' });
  await setup.getByLabel('Session name').fill('Bench practice');
  await setup.getByRole('button', { name: 'Save and continue' }).click();
  await expect(setup.getByRole('alert')).toBeVisible();
  await expect(setup.getByLabel('Session name')).toHaveValue('Bench practice');
  await setup.getByRole('button', { name: 'Save and continue' }).click();
  const editor = page.getByRole('dialog', { name: 'Session exercises' });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('heading', { name: 'Bench practice' })).toBeVisible();
  const { workouts } = await (await page.request.get('/api/workspace')).json();
  expect(workouts).toHaveLength(1);
});
