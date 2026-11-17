import { randomUUID } from 'node:crypto';
import { expect, test } from './signed-in';
import { chooseExercise } from './exercise-picker';

test('trainer instruction shows during readiness and a selected session and question appear in the recap', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 10, 16, 12));
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Add trainer instruction' }).click();
  await chooseExercise(page, 'Exercise for this instruction', 'Bodyweight Squat');
  await page.getByRole('textbox', { name: 'Cue to show during training' }).fill('Pause briefly before standing.');
  await page.getByRole('button', { name: 'Apply instruction' }).click();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile details saved.')).toBeVisible();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Start suggested session' }).click();
  await expect(page.getByText('Trainer cue · Pause briefly before standing.')).toBeVisible();
  await page.getByRole('button', { name: 'Pause session' }).click();

  for (const [name, day, source] of [
    ['Trainer appointment', '2026-11-13', 'trainer'], ['Solo practice', '2026-11-15', 'manual'],
  ]) {
    const created = await page.request.post('/api/workouts', { data: { id: randomUUID(), name, date: day, time: '09:00', source,
      status: 'completed', effort: 6, skippedExerciseIds: ['push-up'], exercises: [{ exerciseId: 'bodyweight-squat', sets: 2, reps: 8 }] } });
    expect(created.ok()).toBeTruthy();
  }
  await page.goto('/sessions');
  await page.getByRole('button', { name: 'Prepare trainer recap' }).click();
  const dialog = page.getByRole('dialog', { name: 'Trainer recap' });
  await dialog.getByRole('textbox', { name: 'Question for your trainer (optional)' }).fill('Should I keep this tempo?');
  const preview = dialog.getByRole('textbox', { name: 'Recap preview' });
  await expect(preview).toHaveValue(/Solo practice[\s\S]*2 × 8 reps[\s\S]*Skipped Push-Up[\s\S]*Should I keep this tempo\?/);
  await dialog.getByRole('button', { name: /Solo practice/ }).click();
  await expect(preview).not.toHaveValue(/Solo practice/);
});

test('profile archive download and preview restore are in Profile', async ({ page }) => {
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Data & privacy' })).toBeVisible();
  await page.getByRole('button', { name: 'Export or restore profile' }).click();
  const dialog = page.getByRole('dialog', { name: 'Data & privacy' });
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('link', { name: 'Download profile archive' }).click()]);
  expect(download.suggestedFilename()).toBe('trainer-plus-profile-archive.json');
  const file = await download.path();
  await dialog.getByLabel('Profile archive file').setInputFiles(file!);
  await dialog.getByRole('button', { name: 'Preview restore' }).click();
  await expect(dialog.getByRole('region', { name: 'Restore preview' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Restore archive' }).click();
  await expect(dialog.getByRole('heading', { name: 'Archive restored' })).toBeVisible();
});

test('the Overview is usable while the full catalog is still downloading', async ({ page }) => {
  let finished = false;
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });
  await page.route('**/api/exercise-catalog', async (route) => {
    await blocked;
    await route.continue();
    finished = true;
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Start suggested session' }).click();
    await expect(page.getByRole('button', { name: 'I’m ready' })).toBeVisible();
    expect(finished).toBe(false);
  } finally {
    unblock();
  }
});

test('Progress finds a comparable prior session and skips a differently loaded one', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 10, 16, 12));
  for (const [day, load, reps] of [['2026-11-10', 12, 8], ['2026-11-13', 16, 6], ['2026-11-15', 12, 10]] as const) {
    const created = await page.request.post('/api/workouts', { data: { id: randomUUID(), name: 'Squat practice', date: day,
      time: '09:00', status: 'completed', exercises: [{ exerciseId: 'goblet-squat', sets: 2, reps, load: { value: load, unit: 'kg' } }] } });
    expect(created.ok()).toBeTruthy();
  }
  await page.goto('/progress?exercise=goblet-squat');
  await expect(page.getByText('Compared with Nov 10')).toBeVisible();
  await expect(page.getByText('4 more reps with the same number of sets and the same loads')).toBeVisible();
});
