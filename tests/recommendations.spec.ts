import { expect, test } from './signed-in';

test('exercise picks can be refined repeatedly and the prior picks survive an error', async ({ page }) => {
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), aiAvailable: true } });
  });
  const refinements: unknown[] = [];
  let failed = false;
  await page.route('**/api/exercises/recommendations?*', async (route) => {
    const refinement = route.request().postDataJSON();
    if (refinement) refinements.push(refinement);
    if (refinement?.adjustment === 'easier' && !failed) {
      failed = true;
      return route.fulfill({ status: 503, json: { error: 'The recommendation service is temporarily unavailable.' } });
    }
    if (refinement?.adjustment === 'longer') return route.fulfill({ json: [
      { exerciseId: 'incline-push-up', reason: 'An easier press.' }, { exerciseId: 'dumbbell-bench-press', reason: 'Adds a second option.' },
    ] });
    return route.fulfill({ json: [refinement
      ? { exerciseId: 'incline-push-up', reason: 'An easier press.' }
      : { exerciseId: 'push-up', reason: 'A bodyweight press.' }] });
  });

  await page.goto('/explore?muscles=Chest');
  await expect(page.getByRole('heading', { name: 'Exercise recommendations', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Get recommendations', exact: true }).click();
  await expect(page.getByText('A bodyweight press.')).toBeVisible();
  const controls = page.getByRole('group', { name: 'Refine recommendation' });
  for (const name of ['Make it easier', 'Make it harder', 'Fewer picks', 'More picks']) {
    await expect(controls.getByRole('button', { name })).toBeVisible();
  }
  await controls.getByRole('button', { name: 'Make it easier' }).press('Enter');
  await expect(page.getByText('The recommendation service is temporarily unavailable.')).toBeVisible();
  await expect(page.getByText('A bodyweight press.')).toBeVisible();
  await page.getByRole('button', { name: 'Retry refinement' }).click();
  await expect(page.getByText('An easier press.')).toBeVisible();
  await controls.getByRole('button', { name: 'More picks' }).click();
  await expect(page.getByText('Adds a second option.')).toBeVisible();
  expect(refinements).toEqual([
    { adjustment: 'easier', previous: ['push-up'] }, { adjustment: 'easier', previous: ['push-up'] },
    { adjustment: 'longer', previous: ['incline-push-up'] },
  ]);

  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ body: '' }));
  const picks = page.getByRole('list', { name: 'Recommended exercises' });
  await picks.getByRole('button', { name: /Incline Push-Up/ }).click();
  const exercise = page.getByRole('dialog', { name: 'Incline Push-Up' });
  await expect(exercise.getByRole('button', { name: 'Add to workout' })).toBeInViewport();
  await exercise.getByRole('button', { name: 'Add to workout' }).click();
  await page.getByRole('button', { name: 'Start a new workout' }).click();
  const editor = page.getByRole('dialog', { name: 'Schedule a workout' });
  await expect(editor.getByRole('textbox', { name: 'Reps · Incline Push-Up' })).toHaveValue('10');
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Incline Push-Up workout' })).toBeVisible();
});

test('a workout can be refined, accepted, and scheduled without selecting any exercises', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), aiAvailable: true } });
  });
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Schedule workout', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: 'Schedule a workout' });
  await editor.getByRole('button', { name: 'Suggest a workout', exact: true }).press('Enter');
  await expect(editor.getByText('4 exercises · 8 sets')).toBeVisible();
  const preview = editor.getByRole('list', { name: 'Suggested exercises' });
  await expect(preview.getByText('2 × 6 reps').first()).toBeVisible();
  await editor.getByRole('button', { name: 'Make it easier' }).click();
  await expect(preview.getByText('2 × 5 reps').first()).toBeVisible();
  await editor.getByRole('button', { name: 'Make it shorter' }).click();
  await expect(editor.getByText('4 exercises · 4 sets')).toBeVisible();
  await editor.getByRole('button', { name: 'Make it longer' }).click();
  await expect(preview.getByText('2 × 5 reps').first()).toBeVisible();
  await editor.getByRole('button', { name: 'Make it harder' }).click();
  await expect(preview.getByText('2 × 6 reps').first()).toBeVisible();
  await editor.getByRole('button', { name: 'Make it harder' }).click();
  await expect(preview.getByText('2 × 7 reps').first()).toBeVisible();
  await editor.getByRole('button', { name: 'Use this workout' }).click();
  await expect(editor.getByRole('textbox', { name: 'Workout name' })).toHaveValue('Balanced strength');
  await expect(editor.getByRole('textbox', { name: 'Reps · Bodyweight Squat' })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Edit exercises' }).click();
  await expect(editor.getByRole('textbox', { name: 'Reps · Bodyweight Squat' })).toHaveValue('7');

  const saved = page.waitForResponse((response) => response.url().includes('/api/workouts?') && response.request().method() === 'POST');
  await editor.getByRole('button', { name: 'Save workout' }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  const [workout] = (await response.json()).workouts.upsert;
  expect(workout.source).toBe('recommended');
  expect(workout.exercises).toEqual(expect.arrayContaining([{ sets: 2, reps: 7, exerciseId: 'bodyweight-squat' }]));
  await page.reload();
  await expect(page.getByText('Balanced strength', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('today’s guided session starts from the adjusted targets', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Make it easier' }).click();
  await expect(page.getByText('Lowered the rep or hold targets.')).toBeVisible();
  await page.getByRole('button', { name: 'Start suggested session' }).click();
  const session = page.getByRole('dialog', { name: 'Balanced strength' });
  await session.getByRole('button', { name: 'I’m ready' }).click();
  await expect(session.getByRole('textbox', { name: 'Reps · Bodyweight Squat' })).toHaveValue('5');
});
