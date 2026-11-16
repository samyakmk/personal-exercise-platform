import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createBrowserProfile, expect, test } from './signed-in';
import { chooseExercise } from './exercise-picker';
import type { Page } from '@playwright/test';

async function openWorkoutDetails(page: Page, name: string, occurrence = 0) {
  const details = page.getByRole('button', { name: 'Details · ' + name, exact: true }).nth(occurrence);
  await expect(details).toBeVisible();
  if (await details.getAttribute('aria-expanded') !== 'true') await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'true');
}


test('filters, empty state, saved gear, and the YouTube demonstration', async ({ page }) => {
  // The player shell is exercised deterministically. YouTube owns the external playback boundary.
  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<button>Play demonstration</button>',
  }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Training overview' })).toBeVisible();
  await page.getByRole('button', { name: 'Explore exercises' }).click();
  await expect(page.getByText('689 exercises', { exact: true })).toBeVisible();
  const barbellSquat = page.getByRole('button', { name: /^Barbell Squat Legs/ });
  await expect(barbellSquat).toHaveCount(0);
  for (let pageNumber = 0; pageNumber < 2; pageNumber += 1) {
    await page.getByRole('button', { name: 'Show more exercises' }).click();
  }
  await expect(barbellSquat).toBeVisible();
  await expect(page.getByLabel('Difficulty')).toHaveCount(0);
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByLabel('Difficulty').selectOption('Intermediate');
  await expect(page.getByText('229 exercises', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Push-Up Chest/ })).toBeVisible();
  await page.getByLabel('Difficulty').selectOption('');
  await page.getByRole('button', { name: 'Bodyweight only' }).click();
  await expect(page.getByText('131 exercises', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Bird Dog\s/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search exercises' }).fill('pull-up');
  await expect(page.getByText('No matching exercises')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('button', { name: 'My equipment', exact: true }).click();
  const equipment = page.getByRole('dialog', { name: 'My equipment' });
  await equipment.getByRole('button', { name: 'Dumbbells', exact: true }).click();
  await equipment.getByRole('button', { name: 'Save equipment' }).click();
  await expect(page.getByText('202 exercises', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('202 exercises', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search exercises' }).fill('goblet');
  const card = page.getByRole('button', { name: /^Goblet Squat\s/ });
  await expect(page.getByText('1 exercise', { exact: true })).toBeVisible();
  await card.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Goblet Squat' });
  await expect(dialog.locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/NIrcxSkwui8/);
  await expect(dialog.frameLocator('iframe').getByRole('button', { name: 'Play demonstration' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Watch on YouTube' })).toHaveAttribute('href', /watch\?v=NIrcxSkwui8/);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(card).toBeFocused();
});

test('the library filters and opens imported exercise demos with muscle tags and source links', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ body: '<button>Play demo</button>', contentType: 'text/html' }));
  await page.route('https://player.vimeo.com/**', (route) => route.fulfill({ body: '<button>Play demo</button>', contentType: 'text/html' }));
  await page.route('https://i.ytimg.com/**', (route) => route.abort());
  await page.route('https://i.vimeocdn.com/**', (route) => route.abort());
  await page.goto('/explore');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Exercise type').selectOption('Strength');
  await page.getByRole('textbox', { name: 'Search exercises' }).fill('barbell squat quadriceps');
  const card = page.getByRole('button', { name: /^Barbell Squat Legs/ });
  await expect(card).toContainText('Video');
  await card.click();
  const squat = page.getByRole('dialog', { name: 'Barbell Squat', exact: true });
  await expect(squat.getByText('Primary muscles', { exact: true })).toBeVisible();
  await expect(squat.getByText('Quadriceps', { exact: true })).toBeVisible();
  await expect(squat.getByText('Hamstrings', { exact: true })).toBeVisible();
  await expect(squat.getByRole('heading', { name: 'How to do it' })).toBeVisible();
  await expect(squat.getByRole('link', { name: 'PureGym' })).toHaveAttribute('href', /puregym\.com\/exercises\/.*barbell-back-squat/);
  await expect(squat.frameLocator('iframe').getByRole('button', { name: 'Play demo' })).toBeVisible();

  await page.goto('/explore?exercise=fedb-chin-up');
  const chinUp = page.getByRole('dialog', { name: 'Chin-Up', exact: true });
  await expect(chinUp.getByRole('link', { name: 'Watch on Vimeo' })).toHaveAttribute('href', /^https:\/\/vimeo\.com\/\d+$/);
  await expect(chinUp.frameLocator('iframe').getByRole('button', { name: 'Play demo' })).toBeVisible();

  await page.goto('/explore?exercise=fedb-all-fours-quad-stretch');
  await expect(page.getByText('This exercise is no longer in the library.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('an exercise picker narrows the catalog while typing and saves an imported exercise', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 750 });
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Schedule workout', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: 'Schedule a workout' });
  const picker = editor.getByRole('combobox', { name: 'Choose an exercise' });
  const list = editor.getByRole('listbox', { name: 'Choose an exercise' });
  const add = editor.getByRole('button', { name: 'Add', exact: true });
  await editor.getByRole('button', { name: 'Show exercises' }).click();
  await expect(list.getByRole('option', { name: 'Goblet Squat', exact: true })).toBeVisible();
  await page.keyboard.type('sho');
  await expect(list.getByRole('option', { name: 'Goblet Squat', exact: true })).toHaveCount(0);
  await expect(list.getByRole('option', { name: 'Standing Dumbbell Shoulder Press', exact: true })).toBeVisible();
  await page.keyboard.type('ulder press');
  await expect(list.getByRole('option', { name: 'Shoulder Circles', exact: true })).toHaveCount(0);
  const firstMatch = list.getByRole('option').first();
  const secondMatch = list.getByRole('option').nth(1);
  await expect(firstMatch).toHaveText('Shoulder Press - With Bands');
  await picker.press('ArrowDown');
  await expect(secondMatch).toHaveAttribute('aria-selected', 'true');
  await picker.press('ArrowUp');
  await expect(firstMatch).toHaveAttribute('aria-selected', 'true');
  await expect(add).toBeDisabled();
  await picker.press('Escape');
  await expect(list).toBeHidden();
  await expect(editor).toBeVisible();
  await picker.fill('unlisted exercise 123');
  await expect(editor.getByRole('status')).toHaveText('No matching exercises');
  await picker.press('Enter');
  await expect(add).toBeDisabled();
  await picker.fill('barbell squat');
  await picker.press('Enter');
  await expect(picker).toHaveValue('Barbell Squat');
  await add.click();
  await expect(picker).toBeEmpty();
  await picker.fill('barbell squat');
  await expect(list.getByRole('option', { name: 'Barbell Squat', exact: true })).toHaveCount(0);
  await picker.press('Escape');
  await editor.getByRole('textbox', { name: 'Weight · Barbell Squat' }).fill('95');
  await editor.getByRole('textbox', { name: 'Workout name' }).fill('Barbell training');
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Barbell training' })).toBeVisible();
  await page.reload();
  await openWorkoutDetails(page, 'Barbell training');
  await expect(page.getByText(/Barbell Squat/)).toBeVisible();
  await expect(page.getByText(/95 lb/)).toBeVisible();
});

test('the exercise grid keeps focus when its desktop column count changes', async ({ page }) => {
  await page.goto('/explore');
  const card = page.getByRole('button', { name: /^Goblet Squat\s/ });
  const next = page.getByRole('button', { name: /^Single-Arm Dumbbell Row\s/ });
  await card.focus();
  await expect(card).toBeFocused();
  const wideCard = (await card.boundingBox())!;
  const wideNext = (await next.boundingBox())!;
  expect(wideCard.y).toBe(wideNext.y);
  await page.setViewportSize({ width: 550, height: 900 });
  await expect(card).toBeFocused();
  await expect.poll(async () => (await next.boundingBox())!.y).toBeGreaterThan((await card.boundingBox())!.y);
});

test('the primary navigation stays beside the page at laptop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const main = page.getByRole('main');
  for (const [destination, title] of [
    ['Sessions', 'Sessions'],
    ['Workouts', 'Workouts'],
    ['Exercises', 'Exercise library'],
    ['Progress', 'Training progress'],
    ['Form Review', 'Form review'],
    ['Overview', 'Training overview'],
  ]) {
    const link = nav.getByRole('link', { name: destination, exact: true });
    await link.press('Enter');
    await expect(main.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(main).toBeFocused();
    const rail = (await nav.boundingBox())!;
    const content = (await main.boundingBox())!;
    expect(rail.height).toBeGreaterThan(content.y);
    expect(content.x).toBeGreaterThanOrEqual(rail.x + rail.width - 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280);
});

test('saved exercises survive reload and rise to the top of the workout picker', async ({ page }) => {
  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/explore');
  await page.getByRole('button', { name: 'Saved exercises (0)' }).click();
  await expect(page.getByText('No saved exercises yet')).toBeVisible();
  await page.getByRole('button', { name: 'Browse exercises' }).click();
  await page.getByRole('button', { name: /^Incline Push-Up Chest/ }).click();
  const exercise = page.getByRole('dialog', { name: 'Incline Push-Up' });
  await exercise.getByRole('button', { name: 'Save exercise', exact: true }).click();
  await expect(exercise.getByRole('button', { name: 'Remove saved exercise' })).toBeVisible();
  await page.reload();
  await exercise.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Saved exercises (1)' }).click();
  await expect(page.getByText('1 exercise', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Incline Push-Up Chest/ })).toBeVisible();
  await page.getByRole('button', { name: 'New workout' }).click();
  const editor = page.getByRole('dialog', { name: 'Schedule a workout' });
  const picker = editor.getByRole('combobox', { name: 'Choose an exercise' });
  await picker.press('ArrowDown');
  await expect(editor.getByRole('listbox', { name: 'Choose an exercise' }).getByRole('option').first())
    .toHaveText('Incline Push-Up · Saved');
  await picker.press('Escape');
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('link', { name: 'Exercises', exact: true }).click();
  await page.getByRole('button', { name: /^Incline Push-Up Chest/ }).click();
  await exercise.getByRole('button', { name: 'Remove saved exercise' }).click();
  await expect(exercise.getByRole('button', { name: 'Save exercise', exact: true })).toBeVisible();
});

test('an exercise demonstration link opens directly and can be closed without clearing filters', async ({ page }) => {
  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/explore?exercise=incline-push-up');
  const dialog = page.getByRole('dialog', { name: 'Incline Push-Up' });
  await expect(dialog).toBeVisible();
  await page.reload();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/\/explore$/);
  await page.getByRole('textbox', { name: 'Search exercises' }).fill('incline');
  await page.getByRole('button', { name: /^Incline Push-Up Chest/ }).click();
  await expect(page).toHaveURL(/\?exercise=incline-push-up$/);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search exercises' })).toHaveValue('incline');
  await page.getByRole('textbox', { name: 'Search exercises' }).clear();
  await page.getByRole('button', { name: 'Chest', exact: true }).click();
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('button', { name: 'Bodyweight only' }).click();
  await page.getByLabel('Difficulty').selectOption('Intermediate');
  await expect(page.getByText('3 exercises', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Push-Up Chest/ }).click();
  await page.reload();
  const pushup = page.getByRole('dialog', { name: 'Push-Up', exact: true });
  await expect(pushup).toBeVisible();
  await expect(pushup.getByRole('heading', { name: 'Do and avoid' })).toBeVisible();
  await pushup.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('button', { name: 'Chest', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Filters (2)' })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Filters (2)' }).click();
  await expect(page.getByRole('button', { name: 'Bodyweight only' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Difficulty')).toHaveValue('Intermediate');
  await expect(page.getByText('3 exercises', { exact: true })).toBeVisible();
});

test('creates and edits a workout from Explore, logs actual sets, and deletes it', async ({ page }) => {
  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/explore');
  await page.getByRole('button', { name: /^Goblet Squat\s/ }).click();
  await page.getByRole('button', { name: 'Add to workout' }).click();
  await page.getByRole('button', { name: 'Start a new workout' }).click();
  let editor = page.getByRole('dialog');
  await editor.getByRole('textbox', { name: 'Workout name' }).fill('Strength practice');
  await editor.getByRole('textbox', { name: 'Weight per dumbbell · Goblet Squat' }).fill('12.5');
  await editor.getByLabel('Unit · Goblet Squat').selectOption('kg');
  await chooseExercise(editor, 'Choose an exercise', 'Forearm Plank');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Seconds · Forearm Plank' }).fill('35');
  await editor.getByRole('button', { name: 'Move Forearm Plank up' }).click();
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Strength practice' })).toBeVisible();
  await openWorkoutDetails(page, 'Strength practice');
  const [calendar] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download calendar file · Strength practice' }).click(),
  ]);
  expect(calendar.suggestedFilename()).toBe('liftmorrow-calendar.ics');
  expect(await readFile((await calendar.path())!, 'utf8')).toContain('SUMMARY:Strength practice');
  await page.reload();
  await openWorkoutDetails(page, 'Strength practice');
  await page.getByRole('button', { name: 'Edit workout · Strength practice' }).click();
  editor = page.getByRole('dialog');
  const setFields = editor.getByRole('textbox', { name: /^Sets · / });
  await expect(setFields).toHaveCount(2);
  await expect(setFields.nth(0)).toHaveAccessibleName('Sets · Forearm Plank');
  await expect(setFields.nth(1)).toHaveAccessibleName('Sets · Goblet Squat');
  await editor.getByRole('textbox', { name: 'Workout name' }).fill('Strength practice revised');
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
  await openWorkoutDetails(page, 'Strength practice revised');
  await page.getByRole('button', { name: 'Log as completed · Strength practice revised' }).click();
  await editor.getByRole('textbox', { name: 'Sets · Goblet Squat' }).fill('2');
  await editor.getByRole('textbox', { name: 'Reps · Goblet Squat' }).fill('8');
  await editor.getByRole('button', { name: 'Save workout log' }).click();
  await openWorkoutDetails(page, 'Strength practice revised');
  await expect(page.getByText('2 × 8 reps · 12.5 kg', { exact: true })).toBeVisible();
  await expect(page.getByText('3 × 35 sec', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Export and backup' }).click();
  const [historyExport] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download history CSV' }).click(),
  ]);
  expect(historyExport.suggestedFilename()).toBe('liftmorrow-history.csv');
  expect(await readFile((await historyExport.path())!, 'utf8')).toContain('Strength practice revised,Goblet Squat,2,8,reps,12.5,kg');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByText('Workouts logged', { exact: true }).locator('..')).toContainText('1');
  await page.getByRole('link', { name: 'Workouts', exact: true }).click();
  await page.getByRole('button', { name: 'History (1)' }).click();
  await openWorkoutDetails(page, 'Strength practice revised');
  await page.getByRole('button', { name: 'Repeat workout · Strength practice revised' }).click();
  await expect(editor.getByRole('textbox', { name: 'Weight per dumbbell · Goblet Squat' })).toHaveValue('12.5');
  await editor.getByRole('textbox', { name: 'Workout name' }).fill('Next strength workout');
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Next strength workout' })).toBeVisible();
  await page.getByRole('button', { name: 'History (1)' }).click();
  const history = page.getByRole('textbox', { name: 'Search workout history' });
  await history.fill('plank');
  await expect(page.getByRole('heading', { name: 'Strength practice revised' })).toBeVisible();
  await history.fill('something else');
  await expect(page.getByText('No matching workouts')).toBeVisible();
  await page.getByRole('button', { name: 'Clear workout search' }).click();
  await openWorkoutDetails(page, 'Strength practice revised');
  await page.getByRole('button', { name: 'Edit workout · Strength practice revised' }).click();
  await editor.getByRole('button', { name: 'Delete workout' }).click();
  await editor.getByRole('button', { name: 'Delete workout' }).click();
  await expect(page.getByRole('heading', { name: 'Strength practice revised' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'History (0)' })).toBeVisible();
});

test('uses local workout times for next up and logs a planned session at the actual time', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 12, 17, 29, 0) });
  await page.goto('/');
  await page.getByRole('button', { name: 'Load sample workouts' }).click();
  await expect(page.getByText('Workouts logged', { exact: true }).locator('..')).toContainText('0');
  await expect(page.getByText('Upper Body Strength', { exact: true })).toBeVisible();
  await page.clock.fastForward(2 * 60_000);
  await expect(page.getByText('Lower Body Strength', { exact: true })).toBeVisible();
  await expect(page.getByText('1 past workout is still on your schedule.')).toBeVisible();

  await page.getByRole('link', { name: 'Workouts' }).click();
  await expect(page.getByText('Past scheduled time')).toBeVisible();
  await openWorkoutDetails(page, 'Lower Body Strength');
  await page.getByRole('button', { name: 'Log as completed · Lower Body Strength' }).click();
  const editor = page.getByRole('dialog', { name: 'Log planned workout' });
  await expect(editor.getByLabel('Date')).toHaveValue('2026-11-12');
  await expect(editor.getByLabel('Time', { exact: true })).toHaveValue('17:31');
  await editor.getByRole('button', { name: '30s · Start rest timer' }).click();
  const rest = page.getByRole('dialog', { name: 'Rest timer' });
  await expect(rest.getByRole('timer')).toHaveText('0:30');
  await page.clock.fastForward(31_000);
  await expect(rest.getByRole('status')).toHaveText('Rest complete');
  await rest.getByRole('button', { name: 'Done' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.getByRole('button', { name: 'Custom rest duration' }).click();
  await expect(editor.getByRole('button', { name: 'Start custom timer' })).toBeDisabled();
  await editor.getByRole('textbox', { name: 'Rest seconds' }).fill('95');
  await editor.getByRole('textbox', { name: 'Rest seconds' }).press('Enter');
  await expect(rest.getByRole('timer')).toHaveText('1:35');
  await expect(rest.getByRole('timer')).toBeInViewport();
  await rest.getByRole('button', { name: 'Stop timer' }).click();
  await editor.getByRole('button', { name: 'Save workout log' }).click();
  await page.getByRole('button', { name: 'Remove sample workouts' }).click();
  await expect(page.getByRole('button', { name: 'History (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lower Body Strength' })).toBeVisible();
});

test('progress summarizes completed personal workouts and compares dumbbell units', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 12, 17, 29, 0) });
  await page.goto('/');
  await page.getByRole('button', { name: 'Load sample workouts' }).click();
  await page.getByRole('button', { name: 'View progress' }).click();
  await expect(page.getByRole('heading', { name: 'Training progress' })).toBeVisible();
  await expect(page.getByText('Your first workout goes here')).toBeVisible();
  const entries = [
    ['First practice', '2026-11-03', 'completed', 12, 'kg'],
    ['Second practice', '2026-11-12', 'completed', 25, 'lb'],
    ['Planned only', '2026-11-12', 'planned', 35, 'kg'],
    ['Future completed record', '2026-11-15', 'completed', 50, 'kg'],
  ] as const;
  for (const [name, date, status, value, unit] of entries) {
    const response = await page.request.post('/api/workouts', { data: {
      id: randomUUID(), name, date, time: '08:00', status,
      exercises: [{ exerciseId: 'goblet-squat', sets: 3, reps: 8, load: { value, unit } }],
    } });
    expect(response.ok()).toBeTruthy();
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Weekly activity' })).toBeVisible();
  await expect(page.getByText('workouts logged in six weeks').locator('..')).toContainText('2');
  const currentWeek = page.getByRole('link', { name: /View workout history, Week of Nov 9, current week, 1 workout/ });
  await expect(currentWeek).toBeVisible();
  await expect(page.getByLabel('Exercise history')).toHaveValue('Goblet Squat');
  await expect(page.getByText('Latest session', { exact: true }).locator('..')).toContainText('3 × 8 reps · 25 lb');
  await expect(page.getByText('Heaviest logged dumbbell').locator('..')).toContainText('12 kg');
  const trend = page.getByRole('list', { name: 'Heaviest dumbbell (lb) across recent sessions' });
  await expect(trend.getByRole('listitem', { name: /First practice.*26\.5 lb/ })).toBeVisible();
  await expect(trend.getByRole('listitem', { name: /Second practice.*25 lb/ })).toBeVisible();
  await expect(page.getByText('Planned only')).toHaveCount(0);
  await currentWeek.click();
  await expect(page.getByRole('heading', { name: 'Second practice' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'First practice' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Future completed record' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'History (2)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Show all history' })).toBeVisible();
  await page.getByRole('button', { name: 'Show all history' }).click();
  await expect(page.getByRole('heading', { name: 'Future completed record' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'First practice' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Progress', exact: true }).click();
  await page.getByRole('button', { name: 'Open workout · Second practice' }).click();
  await expect(page.getByRole('textbox', { name: 'Workout name' })).toHaveValue('Second practice');
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Progress', exact: true }).click();
  await chooseExercise(page, 'Exercise history', 'Forearm Plank');
  await expect(page).toHaveURL(/\?exercise=forearm-plank$/);
  await page.reload();
  await expect(page.getByLabel('Exercise history')).toHaveValue('Forearm Plank');
  await page.getByRole('button', { name: 'Log Forearm Plank' }).click();
  await expect(page.getByRole('textbox', { name: 'Seconds · Forearm Plank' })).toBeVisible();
});

test('individual sets can vary by reps and weight and are restored after reload', async ({ page }) => {
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'History (0)' }).click();
  await page.getByRole('button', { name: 'Log workout', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: 'Log a workout' });
  await editor.getByRole('textbox', { name: 'Workout name' }).fill('Varying weights');
  await chooseExercise(editor, 'Choose an exercise', 'Goblet Squat');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Sets · Goblet Squat', exact: true }).fill('2');
  await editor.getByRole('textbox', { name: 'Weight per dumbbell · Goblet Squat', exact: true }).fill('20');
  await editor.getByRole('button', { name: 'Log each set · Goblet Squat' }).click();
  await expect(editor.getByRole('textbox', { name: 'Weight per dumbbell · Set 2 · Goblet Squat' })).toHaveValue('20');
  await editor.getByRole('textbox', { name: 'Weight per dumbbell · Set 2 · Goblet Squat' }).fill('12.5');
  await editor.getByLabel('Unit · Set 2 · Goblet Squat').selectOption('kg');
  await editor.getByRole('textbox', { name: 'Reps · Set 2 · Goblet Squat' }).fill('8');
  await editor.getByRole('button', { name: 'Add set · Goblet Squat' }).click();
  await expect(editor.getByRole('textbox', { name: 'Reps · Set 3 · Goblet Squat' })).toHaveValue('8');
  await editor.getByRole('button', { name: 'Remove Set 3 · Goblet Squat' }).click();
  await editor.getByRole('button', { name: 'Save workout log' }).click();
  await openWorkoutDetails(page, 'Varying weights');
  await expect(page.getByText('2 sets · 8–10 reps', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'History (1)' }).click();
  await openWorkoutDetails(page, 'Varying weights');
  await page.getByRole('button', { name: 'Edit workout · Varying weights' }).click();
  await expect(page.getByRole('textbox', { name: 'Reps · Set 2 · Goblet Squat' })).toHaveValue('8');
  await expect(page.getByRole('textbox', { name: 'Weight per dumbbell · Set 2 · Goblet Squat' })).toHaveValue('12.5');
  await expect(page.getByLabel('Unit · Set 2 · Goblet Squat')).toHaveValue('kg');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Progress', exact: true }).click();
  const toggle = page.getByRole('button', { name: 'Show sets · Varying weights' });
  await toggle.press('Enter');
  const sets = page.getByRole('list', { name: 'Sets for Varying weights' });
  await expect(sets.getByRole('listitem')).toHaveCount(2);
  await expect(sets.getByText('8 reps · 12.5 kg per dumbbell')).toBeVisible();
  await page.getByRole('button', { name: 'Hide sets · Varying weights' }).press('Enter');
  await expect(sets).toHaveCount(0);
  await expect(page.getByText('Heaviest logged dumbbell').locator('..')).toContainText('12.5 kg');
});

test('an unfinished workout draft can be resumed after reloading the same tab', async ({ page, context }) => {
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Schedule workout', exact: true }).first().click();
  const editor = page.getByRole('dialog');
  await editor.getByRole('textbox', { name: 'Workout name' }).fill('Unfinished workout');
  await expect(editor.getByRole('textbox', { name: 'Workout notes' })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Workout options' }).click();
  await editor.getByRole('textbox', { name: 'Workout notes' }).fill('Leave time for a warm-up.');
  await chooseExercise(editor, 'Choose an exercise', 'Dead Bug');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Reps · Dead Bug' }).fill('14');
  await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((name) => name.startsWith('liftmorrow-workout-draft:'))!;
    sessionStorage.setItem(key.replace('liftmorrow-', 'repform-'), sessionStorage.getItem(key)!);
    sessionStorage.removeItem(key);
  });
  await page.reload();
  await page.getByRole('button', { name: 'Resume draft' }).click();
  await expect(editor.getByRole('textbox', { name: 'Workout name' })).toHaveValue('Unfinished workout');
  await expect(editor.getByRole('textbox', { name: 'Reps · Dead Bug' })).toHaveValue('14');
  await expect(editor.getByRole('textbox', { name: 'Workout notes' })).toHaveValue('Leave time for a warm-up.');
  const second = await context.newPage();
  try {
    await second.goto('/workouts');
    await expect(second.getByRole('heading', { name: 'Workouts', exact: true })).toBeVisible();
    await expect(second.getByRole('button', { name: 'Resume draft' })).toHaveCount(0);
  } finally {
    await second.close();
  }
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unfinished workout' })).toBeVisible();
  await openWorkoutDetails(page, 'Unfinished workout');
  await expect(page.getByText('Leave time for a warm-up.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Unfinished workout' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume draft' })).toHaveCount(0);
});

test('guided session resumes recorded sets and saves only the work performed', async ({ page, context }) => {
  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Schedule workout', exact: true }).first().click();
  const editor = page.getByRole('dialog');
  await editor.getByRole('textbox', { name: 'Workout name' }).fill('Guided strength');
  await chooseExercise(editor, 'Choose an exercise', 'Goblet Squat');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await chooseExercise(editor, 'Choose an exercise', 'Forearm Plank');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();

  await page.getByRole('button', { name: 'Start session · Guided strength' }).click();
  const session = page.getByRole('dialog', { name: 'Guided strength' });
  await session.getByRole('button', { name: 'Switch to manual' }).click();
  await session.getByRole('button', { name: 'Show technique' }).click();
  await expect(session.locator('iframe')).toHaveAttribute('title', 'Goblet Squat demonstration');
  await session.getByRole('button', { name: 'Hide technique' }).click();
  await expect(session.locator('iframe')).toHaveCount(0);
  await session.getByRole('button', { name: 'Decrease reps' }).click();
  await session.getByRole('textbox', { name: 'Weight per dumbbell · Goblet Squat' }).fill('12.5');
  await session.getByLabel('Unit · Goblet Squat').selectOption('kg');
  await session.getByRole('button', { name: 'Record set' }).click();
  await expect(session.getByText('9 reps · 12.5 kg per dumbbell')).toBeVisible();
  const rest = page.getByRole('dialog', { name: 'Rest timer' });
  const hold = page.getByRole('dialog', { name: 'Hold timer' });
  await session.getByRole('button', { name: 'Custom rest duration' }).click();
  await session.getByRole('textbox', { name: 'Rest minutes' }).fill('2');
  await session.getByRole('textbox', { name: 'Rest seconds' }).fill('15');
  await session.getByRole('button', { name: 'Start custom timer' }).click();
  await expect(rest.getByRole('timer')).toHaveText('2:15');
  await page.keyboard.press('Escape');
  await expect(rest).toBeHidden();
  await expect(session.getByRole('button', { name: /^Show timer · 2:/ })).toBeVisible();
  await session.getByRole('button', { name: 'Pause session' }).click();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Current session' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume session', exact: true }).click();
  await expect(rest.getByRole('timer')).toHaveText(/^2:/);
  await rest.getByRole('button', { name: 'Minimize timer' }).click();
  await expect(session.getByText('1 of 6 planned sets recorded')).toBeVisible();
  await expect(session.getByRole('textbox', { name: 'Reps · Goblet Squat' })).toHaveValue('9');
  await expect(session.getByRole('textbox', { name: 'Weight per dumbbell · Goblet Squat' })).toHaveValue('12.5');
  await expect(session.getByLabel('Unit · Goblet Squat')).toHaveValue('kg');
  await session.getByRole('button', { name: /^Show timer ·/ }).click();
  await expect(rest).toBeVisible();
  await rest.getByRole('button', { name: 'Stop timer' }).click();
  await session.getByRole('textbox', { name: 'Reps · Goblet Squat' }).fill('11');
  await session.getByRole('button', { name: 'Next exercise' }).click();
  await session.getByRole('textbox', { name: 'Seconds · Forearm Plank' }).fill('2');
  await session.getByRole('button', { name: /^Goblet Squat ·/ }).click();
  await expect(session.getByRole('textbox', { name: 'Reps · Goblet Squat' })).toHaveValue('11');
  await session.getByRole('button', { name: 'Next exercise' }).click();
  await session.getByRole('button', { name: 'Pause session' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Resume session', exact: true }).first().click();
  await expect(session.getByRole('textbox', { name: 'Seconds · Forearm Plank' })).toHaveValue('2');
  await expect(session.getByText('1 of 6 planned sets recorded')).toBeVisible();
  await session.getByRole('button', { name: 'Start hold timer' }).click();
  await expect(hold.getByRole('timer')).toHaveText('0:02');
  await hold.getByRole('button', { name: 'Minimize timer' }).click();
  await expect(session.getByRole('button', { name: 'Record set' })).toBeDisabled();
  await expect(session.getByText('Hold complete')).toBeVisible();
  await session.getByRole('textbox', { name: 'Seconds · Forearm Plank' }).fill('28');
  await page.clock.install();
  await session.getByRole('button', { name: 'Start hold timer' }).click();
  await hold.getByRole('button', { name: 'Minimize timer' }).click();
  await session.getByRole('button', { name: 'Pause session' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Resume session', exact: true }).first().click();
  await expect(hold.getByRole('button', { name: 'Stop hold timer' })).toBeVisible();
  await page.clock.fastForward(3100);
  await hold.getByRole('button', { name: 'Stop hold timer' }).click();
  await expect(session.getByRole('textbox', { name: 'Seconds · Forearm Plank' })).toHaveValue(/^[3-6]$/);
  await session.getByRole('button', { name: 'Record set' }).click();
  await expect(session.getByText(/^[3-6] sec$/)).toBeVisible();
  await session.getByRole('button', { name: 'Undo last set' }).click();
  await expect(session.getByText('1 of 6 planned sets recorded')).toBeVisible();
  await session.getByRole('button', { name: 'Finish session' }).click();
  await expect(session.getByText(/5 planned sets were left open/)).toBeVisible();
  await session.getByRole('textbox', { name: 'Workout notes' }).fill('Paused between sets.');
  await session.getByRole('button', { name: 'Save workout log' }).click();
  await expect(session).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Guided strength' })).toBeVisible();
  await openWorkoutDetails(page, 'Guided strength');
  await expect(page.getByText('1 set · 9 reps')).toBeVisible();
  await expect(page.getByText('Paused between sets.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Schedule (0)' })).toBeVisible();
  const snapshot = await (await context.request.get('/api/workspace')).json();
  expect(snapshot.workouts).toHaveLength(1);
  expect(snapshot.workouts[0].exercises).toEqual([{
    exerciseId: 'goblet-squat', reps: 9, sets: 1, load: { value: 12.5, unit: 'kg' },
    setDetails: [{ reps: 9, load: { value: 12.5, unit: 'kg' } }],
  }]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume session', exact: true })).toHaveCount(0);
});

test('a guided session saves a separate log when another tab updates the plan', async ({ page, context }) => {
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Schedule workout', exact: true }).first().click();
  const editor = page.getByRole('dialog');
  await editor.getByRole('textbox', { name: 'Workout name' }).fill('Shared strength');
  await chooseExercise(editor, 'Choose an exercise', 'Push-Up');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();

  await page.getByRole('button', { name: 'Start session · Shared strength' }).click();
  const session = page.getByRole('dialog', { name: 'Shared strength' });
  await session.getByRole('button', { name: 'I’m ready' }).click();
  await session.getByRole('button', { name: 'Record set' }).click();
  const second = await context.newPage();
  try {
    await second.goto('/workouts');
    await openWorkoutDetails(second, 'Shared strength');
    await second.getByRole('button', { name: 'Edit workout · Shared strength' }).click();
    const edit = second.getByRole('dialog');
    await edit.getByRole('textbox', { name: 'Workout name' }).fill('Updated strength');
    await edit.getByRole('button', { name: 'Save workout', exact: true }).click();
    await expect(second.getByRole('heading', { name: 'Updated strength' })).toBeVisible();
    await session.getByRole('button', { name: 'Finish session' }).click();
    await expect(session.getByText(/original workout changed/)).toBeVisible();
    await session.getByRole('button', { name: 'Save separate log' }).click();
    await expect(session).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Shared strength' })).toBeVisible();
    const { workouts } = await (await context.request.get('/api/workspace')).json();
    expect(workouts).toHaveLength(2);
    expect(workouts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Updated strength', status: 'planned' }),
      expect.objectContaining({ name: 'Shared strength', status: 'completed', exercises: [expect.objectContaining({ sets: 1 })] }),
    ]));
  } finally {
    await second.close();
  }
});

test('planned set targets carry over to the matching guided sets', async ({ page }) => {
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Schedule workout', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: 'Schedule a workout' });
  await editor.getByRole('textbox', { name: 'Workout name' }).fill('Warm-up and working set');
  await chooseExercise(editor, 'Choose an exercise', 'Goblet Squat');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Sets · Goblet Squat', exact: true }).fill('2');
  await editor.getByRole('button', { name: 'Plan each set · Goblet Squat' }).click();
  await editor.getByRole('textbox', { name: 'Reps · Set 1 · Goblet Squat' }).fill('12');
  await editor.getByRole('textbox', { name: 'Reps · Set 2 · Goblet Squat' }).fill('6');
  await editor.getByRole('textbox', { name: 'Weight per dumbbell · Set 2 · Goblet Squat' }).fill('20');
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
  await page.getByRole('button', { name: 'Start session · Warm-up and working set' }).click();
  const session = page.getByRole('dialog', { name: 'Warm-up and working set' });
  await session.getByRole('button', { name: 'I’m ready' }).click();
  const reps = session.getByRole('textbox', { name: 'Reps · Goblet Squat' });
  await expect(reps).toHaveValue('12');
  await reps.fill('11');
  await session.getByRole('button', { name: 'Record set' }).click();
  await session.getByRole('button', { name: 'Skip rest' }).click();
  await expect(reps).toHaveValue('6');
  await expect(session.getByRole('textbox', { name: 'Weight per dumbbell · Goblet Squat' })).toHaveValue('20');
});

test('weekly scheduling previews the last date and creates independently editable workouts', async ({ page, context }) => {
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Schedule workout', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: 'Schedule a workout' });
  await editor.getByRole('textbox', { name: 'Workout name' }).fill('Weekly core');
  await editor.getByLabel('Date', { exact: true }).fill('2027-03-07');
  await editor.getByLabel('Time', { exact: true }).fill('16:00');
  await editor.getByRole('button', { name: 'Workout options' }).click();
  await editor.getByLabel('Repeat weekly').selectOption('3');
  await expect(editor.getByText('Last session · Sun, Mar 21')).toBeVisible();
  await chooseExercise(editor, 'Choose an exercise', 'Forearm Plank');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await editor.getByRole('button', { name: 'Schedule 3 workouts' }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Weekly core' })).toHaveCount(3);
  const workouts = (await (await context.request.get('/api/workspace')).json()).workouts;
  expect(workouts.map(({ date, time }: { date: string; time: string }) => `${date} ${time}`)).toEqual([
    '2027-03-07 16:00', '2027-03-14 16:00', '2027-03-21 16:00',
  ]);
  await openWorkoutDetails(page, 'Weekly core', 2);
  await page.getByRole('button', { name: 'Edit workout · Weekly core' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit workout' });
  await expect(edit.getByLabel('Repeat weekly')).toHaveCount(0);
  await edit.getByRole('textbox', { name: 'Workout name' }).fill('Last core session');
  await edit.getByRole('button', { name: 'Save workout', exact: true }).click();
  await expect(edit).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Weekly core' })).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Last core session' })).toBeVisible();
});

test('the visible current week advances at the local week boundary', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 29, 23, 59, 59) });
  await page.goto('/workouts');
  await expect(page.getByRole('button', { name: /Sun, Nov 29, today/ })).toBeVisible();
  await page.getByRole('button', { name: /Sun, Nov 29, today/ }).click();
  await expect(page.getByRole('button', { name: 'Show all dates' })).toBeVisible();
  await page.clock.fastForward(2000);
  await expect(page.getByRole('button', { name: /Mon, Nov 30, today/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show all dates' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(page.getByRole('button', { name: /Sun, Nov 29, 0 workouts/ })).toBeVisible();
  await page.getByRole('button', { name: 'This week' }).click();
  await expect(page.getByRole('button', { name: /Mon, Nov 30, today/ })).toBeVisible();
});

test('the workout calendar jumps to a distant date and filters the selected day', async ({ page }) => {
  await page.goto('/workouts');
  await expect(page.getByRole('heading', { name: 'Workouts', exact: true })).toBeVisible();
  for (const [name, date] of [['Selected date workout', '2027-04-07'], ['Another workout that week', '2027-04-08']]) {
    const saved = await page.request.post('/api/workouts', { data: {
      id: randomUUID(), name, date, time: '10:00', status: 'planned', exercises: [{ exerciseId: 'push-up', sets: 2, reps: 8 }],
    } });
    expect(saved.ok()).toBeTruthy();
  }
  await page.reload();
  await page.getByRole('button', { name: 'Go to date' }).click();
  const dialog = page.getByRole('dialog', { name: 'Go to a workout date' });
  await dialog.getByLabel('Workout date to open').fill('2027-04-07');
  await dialog.getByRole('button', { name: 'Show workouts on this date' }).click();
  await expect(page.getByRole('heading', { name: 'Apr 5 – Apr 11, 2027' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Wed, Apr 7, 1 workout/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Selected date workout' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Another workout that week' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Apr 5 – Apr 11, 2027' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Wed, Apr 7, 1 workout/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Another workout that week' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show all dates' }).click();
  await expect(page.getByRole('heading', { name: 'Another workout that week' })).toBeVisible();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page.getByRole('heading', { name: 'Apr 12 – Apr 18, 2027' })).toBeVisible();
  await expect(page.getByText('Nothing saved for this week.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Selected date workout' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(page.getByRole('heading', { name: 'Selected date workout' })).toBeVisible();
  await page.getByRole('button', { name: 'History (0)' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'History (0)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'No workout logs' })).toBeVisible();
});

test('a training backup downloads and restores in a separate workspace', async ({ page, browser }) => {
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Schedule workout', exact: true }).first().click();
  const editor = page.getByRole('dialog');
  await editor.getByRole('textbox', { name: 'Workout name' }).fill('Portable strength');
  await chooseExercise(editor, 'Choose an exercise', 'Push-Up');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole('button', { name: 'Export and backup' }).click();
  const backupDialog = page.getByRole('dialog', { name: 'Export and backup' });
  await page.route((url) => url.pathname === '/api/workspace/training-backup', (route) => route.fulfill({
    status: 413, json: { error: 'This workspace is too large for a single training backup. Choose a narrower date range.' },
  }), { times: 1 });
  await backupDialog.getByRole('link', { name: 'Download training backup' }).click();
  await expect(backupDialog.getByRole('alert')).toContainText('Choose a narrower date range.');
  await expect(backupDialog.getByLabel('Include workouts from')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('link', { name: 'Download training backup' }).click(),
  ]);
  await expect(backupDialog.getByRole('alert')).toHaveCount(0);
  expect(download.suggestedFilename()).toBe('liftmorrow-training-backup.json');
  const content = await readFile((await download.path())!);
  const archivedWorkout = JSON.parse(content.toString('utf8')).workouts[0];
  await page.getByLabel('Include workouts from').fill(archivedWorkout.date);
  await page.getByLabel('Include workouts before').fill(archivedWorkout.date);
  await expect(page.getByText('The end date must be after the start date.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download selected dates' })).toHaveCount(0);
  await page.getByLabel('Include workouts before').fill('');
  const [part] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('link', { name: 'Download selected dates' }).click(),
  ]);
  expect(JSON.parse(await readFile((await part.path())!, 'utf8')).workouts).toEqual([archivedWorkout]);

  const other = await browser.newContext();
  try {
    await createBrowserProfile(other.request, page.url());
    const imported = await other.newPage();
    await imported.goto(new URL('/workouts', page.url()).href);
    await imported.getByRole('button', { name: 'Export and backup' }).click();
    const backup = imported.getByRole('dialog', { name: 'Export and backup' });
    const input = backup.getByLabel('Training backup file');
    await input.setInputFiles({ name: 'unknown.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await expect(backup.getByText('Choose a valid Liftmorrow training backup JSON file.')).toBeVisible();
    const previousBackup = Buffer.from(JSON.stringify({ ...JSON.parse(content.toString('utf8')), format: 'repform-training' }));
    await input.setInputFiles({ name: 'earlier-training-backup.json', mimeType: 'application/json', buffer: previousBackup });
    await expect(backup.getByText('1 workout', { exact: true })).toBeVisible();
    await backup.getByRole('button', { name: 'Restore training data' }).click();
    await expect(backup).not.toBeVisible();
    await expect(imported.getByRole('heading', { name: 'Portable strength' })).toBeVisible();
    await expect(imported.getByText('1 workout added.')).toBeVisible();
    await imported.reload();
    await expect(imported.getByRole('heading', { name: 'Portable strength' })).toBeVisible();
    await imported.getByRole('button', { name: 'Export and backup' }).click();
    await input.setInputFiles({ name: part.suggestedFilename(), mimeType: 'application/json', buffer: content });
    await backup.getByRole('button', { name: 'Restore training data' }).click();
    await expect(imported.getByText('0 workouts added · 1 already present.')).toBeVisible();
    await expect(imported.getByRole('heading', { name: 'Portable strength' })).toHaveCount(1);
  } finally {
    await other.close();
  }
});

test('previews an upload, retries an API error, reopens privately, and deletes the video', async ({ page, browser }) => {
  await page.goto('/form-review');
  await chooseExercise(page, 'Exercise in your clip', 'Goblet Squat');
  const input = page.locator('input[type=file]');
  await input.setInputFiles({ name: 'text.txt', mimeType: 'text/plain', buffer: Buffer.from('not a video') });
  await expect(page.getByText('Choose an MP4, WebM, or MOV video.')).toBeVisible();
  const uploadBytes = await readFile('tests/fixtures/synthetic.mp4');
  const uploadName = 'Séance 训练.mp4';
  await input.setInputFiles({ name: uploadName, mimeType: 'application/octet-stream', buffer: uploadBytes });
  const preview = page.locator('video[aria-label="Video preview"]');
  await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(0);

  await page.route(/\/api\/clips\/[^/]+\?exercise=/, (route) => route.fulfill({
    status: 503, json: { error: 'Temporary upload problem. Try again.' },
  }), { times: 1 });
  await page.getByRole('button', { name: 'Upload video', exact: true }).click();
  await expect(page.getByText('Temporary upload problem. Try again.')).toBeVisible();
  await page.getByRole('button', { name: 'Upload video', exact: true }).click();
  await expect(page.getByText('Video saved to your workspace.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Goblet Squat' })).toBeVisible();
  await expect(page).toHaveURL(/\/form-review\?clip=[a-f\d-]+$/);
  const reviewUrl = page.url();
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Goblet Squat' })).toBeVisible();
  const saved = page.locator('video[aria-label="Saved exercise video"]');
  await expect.poll(() => saved.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(0);
  const clipUrl = await saved.evaluate((video: HTMLVideoElement) => video.src);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('link', { name: 'Download video' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Change exercise' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Delete video' })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('link', { name: 'Download video' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(uploadName);
  expect(await readFile((await download.path())!)).toEqual(uploadBytes);
  const visitor = await browser.newContext();
  try {
    const outsider = await visitor.request.get(clipUrl);
    expect(outsider.status()).toBe(404);
    const downloadUrl = new URL(clipUrl);
    downloadUrl.searchParams.set('download', '1');
    expect((await visitor.request.get(downloadUrl.href)).status()).toBe(404);
    await createBrowserProfile(visitor.request, page.url());
    const guestPage = await visitor.newPage();
    await guestPage.goto(reviewUrl);
    await expect(guestPage.getByText('This video is unavailable in this workspace.')).toBeVisible();
    await expect(guestPage.getByRole('dialog')).toHaveCount(0);
  } finally {
    await visitor.close();
  }
  await dialog.getByRole('button', { name: 'Change exercise' }).click();
  const correction = page.getByRole('dialog', { name: 'Change video exercise' });
  await chooseExercise(correction, 'New exercise selection', 'Incline Push-Up');
  await correction.getByRole('button', { name: 'Save exercise selection' }).click();
  await expect(page.getByRole('dialog', { name: 'Incline Push-Up' })).toBeVisible();
  await expect.poll(() => saved.evaluate((video: HTMLVideoElement) => video.src)).toBe(clipUrl);
  await dialog.getByRole('button', { name: 'Delete video' }).click();
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Delete video' }).click();
  await expect(page.getByText('Your uploaded videos will appear here.')).toBeVisible();
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page).toHaveURL(/\/form-review$/);
  expect((await page.request.get(clipUrl)).status()).toBe(404);
  await expect(page.getByText(/AI analysis is unavailable on this server/)).toBeVisible();
});

test('saved video search matches both filenames and exercise names', async ({ page }) => {
  await page.goto('/form-review');
  await page.getByRole('heading', { name: 'Form review' }).waitFor();
  const body = await readFile('tests/fixtures/synthetic.mp4');
  for (const [name, exercise] of [['garage-morning.mp4', 'push-up'], ['living-room.mp4', 'goblet-squat']]) {
    const response = await page.request.put(`/api/clips/${randomUUID()}?exercise=${exercise}`, {
      data: body, headers: { 'Content-Type': 'video/mp4', 'X-Clip-Name': name },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.reload();
  const search = page.getByRole('textbox', { name: 'Search your videos' });
  await search.fill('morning push-up');
  await expect(page.getByRole('button', { name: 'Open video · garage-morning.mp4' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open video · living-room.mp4' })).toHaveCount(0);
  await search.fill('stairs');
  await expect(page.getByText('No matching videos')).toBeVisible();
  await page.getByRole('button', { name: 'Clear video search' }).click();
  await expect(page.getByRole('button', { name: 'Open video · living-room.mp4' })).toBeVisible();
});

test('an untagged upload starts detection and shows the detected exercise with its feedback', async ({ page }) => {
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), aiAvailable: true } });
  });
  await page.route('**/api/clips/*/review?background=1', (route) => route.fulfill({
    status: 202, json: { review: null, reviewStatus: { state: 'running', sequence: 1, startSeconds: 0 } },
  }));
  let finished = false;
  await page.route('**/api/clips/*/review', (route) => route.fulfill({ json: {
    review: finished ? {
      detectedExerciseId: 'incline-push-up', verdict: 'no_clear_issue', summary: 'The exercise is visible.', limitations: '',
      observations: [], framesReviewed: 8, windowSeconds: 20, reviewedAt: '2026-11-13T07:30:00Z',
    } : null,
    reviewStatus: { state: finished ? 'complete' : 'running', sequence: 1, startSeconds: 0 },
  } }));

  await page.goto('/form-review');
  const picker = page.getByRole('combobox', { name: 'Exercise in your clip' });
  await expect(picker).toHaveValue('Detect for me');
  await chooseExercise(page, 'Exercise in your clip', 'Push-Up');
  await chooseExercise(page, 'Exercise in your clip', 'Detect for me');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/synthetic.mp4');
  const upload = page.waitForRequest((request) => request.method() === 'PUT' && new URL(request.url()).pathname.startsWith('/api/clips/'));
  await page.getByRole('button', { name: 'Upload and analyze' }).click();
  expect(new URL((await upload).url()).searchParams.has('exercise')).toBe(false);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Detecting exercise and analyzing form…')).toBeVisible();
  finished = true;
  await expect(page.getByRole('dialog', { name: 'Incline Push-Up' })).toBeVisible();
  await expect(dialog.getByText('Detected exercise · Incline Push-Up')).toBeVisible();
  await expect(dialog.getByText('The exercise is visible.')).toBeVisible();
});

test('a video upload continues across navigation and can be retried on return', async ({ page }) => {
  await page.goto('/form-review');
  await chooseExercise(page, 'Exercise in your clip', 'Push-Up');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/synthetic.mp4');
  await expect(page.getByRole('button', { name: 'Upload video' })).toBeEnabled();

  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('link', { name: 'Exercises', exact: true }).click();
  await nav.getByRole('link', { name: 'Form Review', exact: true }).click();
  await expect(page.getByLabel('Exercise in your clip')).toHaveValue('Push-Up');
  await expect(page.getByRole('button', { name: 'Upload video' })).toBeEnabled();

  let failUpload!: () => void;
  const release = new Promise<void>((resolve) => { failUpload = resolve; });
  await page.route(/\/api\/clips\/[^/]+\?exercise=/, async (route) => {
    await release;
    await route.fulfill({ status: 503, json: { error: 'Temporary upload failure.' } });
  }, { times: 1 });
  try {
    await page.getByRole('button', { name: 'Upload video' }).click();
    await nav.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page.getByText('Video upload in progress.')).toBeVisible();
    await page.getByRole('button', { name: 'New workout', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Schedule a workout' });
    await editor.getByRole('textbox', { name: 'Workout name' }).fill('Plan during upload');
    await chooseExercise(editor, 'Choose an exercise', 'Push-Up');
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Plan during upload' })).toBeVisible();
    await expect(page.getByText('Video upload in progress.')).toBeVisible();
    failUpload();
    await expect(page.getByText('The video upload needs attention.')).toBeVisible();
    await page.getByRole('button', { name: 'Open Form Review' }).click();
    await expect(page.getByText('Temporary upload failure.')).toBeVisible();
    await expect(page.getByLabel('Exercise in your clip')).toHaveValue('Push-Up');
    await page.getByRole('button', { name: 'Upload video' }).click();
    await expect(page.getByRole('dialog', { name: 'Push-Up' })).toBeVisible();
  } finally {
    failUpload();
  }
});

test('dragging a clip gives feedback and opens the preview', async ({ page }) => {
  await page.goto('/form-review');
  await chooseExercise(page, 'Exercise in your clip', 'Push-Up');
  const area = page.getByRole('group', { name: 'Video drop area' });
  const video = await readFile('tests/fixtures/synthetic.mp4');
  const drag = await page.evaluateHandle((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'dragged.mp4', { type: 'video/mp4' }));
    return transfer;
  }, [...video]);
  await area.dispatchEvent('dragover', { dataTransfer: drag });
  await expect(page.getByText('Release to select video')).toBeVisible();
  await area.dispatchEvent('drop', { dataTransfer: drag });
  await expect(page.getByText(/dragged\.mp4/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload video' })).toBeEnabled();
});

test('a late upload response cannot restore a clip removed in another tab', async ({ page, context }) => {
  await page.goto('/form-review');
  await chooseExercise(page, 'Exercise in your clip', 'Push-Up');
  await page.locator('input[type=file]').setInputFiles({
    name: 'synthetic.mp4', mimeType: 'video/mp4', buffer: await readFile('tests/fixtures/synthetic.mp4'),
  });
  const release = Promise.withResolvers<void>();
  const committed = Promise.withResolvers<number>();
  await page.route(/\/api\/clips\/[^/]+\?exercise=/, async (route) => {
    const response = await route.fetch();
    committed.resolve(response.status());
    await release.promise;
    await route.fulfill({ response });
  }, { times: 1 });
  const second = await context.newPage();
  try {
    await page.getByRole('button', { name: 'Upload video' }).click();
    expect(await committed.promise).toBe(200);
    await second.goto('/form-review');
    const clipButton = second.getByRole('button', { name: 'Open video · synthetic.mp4' });
    await clipButton.click();
    const deletion = second.getByRole('dialog').getByRole('button', { name: 'Delete video', exact: true });
    await deletion.click();
    const refreshed = page.waitForResponse(async (response) => {
      return response.url().endsWith('/api/workspace') && response.status() === 200
        && (await response.json()).clips.length === 0;
    });
    await deletion.click();
    await expect(second.getByText('Your uploaded videos will appear here.')).toBeVisible();
    await refreshed;
    release.resolve();
    await expect(page.getByText('This video was removed before the upload was confirmed.')).toBeVisible();
    await expect(page.getByText('Your uploaded videos will appear here.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    release.resolve();
    await second.close();
  }
});

test('form review keeps progress across reload and seeks to the feedback timestamp', async ({ page }) => {
  const feedback = {
    verdict: 'observations', summary: '', limitations: '',
    observations: [{ timestamp: 0.5, comparisonTimestamp: 0, kind: 'adjustment', observation: 'The hips rise.', cue: 'Brace before lowering.' }],
    framesReviewed: 4, windowSeconds: 20, reviewedAt: '2026-11-13T07:30:00Z', version: 6,
  };
  let started = false;
  let finished = false;
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    const workspace = await response.json();
    if (started) {
      workspace.clips[0].reviewStatus = { state: 'running', sequence: 1 };
    }
    await route.fulfill({ response, json: { ...workspace, aiAvailable: true } });
  });
  await page.route('**/api/clips/*/review?background=1', (route) => {
    started = true;
    return route.fulfill({ status: 202, json: { review: null, reviewStatus: { state: 'running', sequence: 1 } } });
  });
  await page.route('**/api/clips/*/review', (route) => route.fulfill({ json: {
    review: finished ? feedback : null,
    reviewStatus: { state: finished ? 'complete' : 'running', sequence: 1 },
  } }));

  await page.goto('/form-review');
  await chooseExercise(page, 'Exercise in your clip', 'Push-Up');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/synthetic.mp4');
  await page.getByRole('button', { name: 'Upload video' }).click();
  const openVideo = page.getByRole('button', { name: 'Open video · synthetic.mp4' });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Analyze form' }).click();
  await expect(dialog.getByText('Analyzing visible form…')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByText('Analyzing', { exact: true })).toBeVisible();
  await page.reload();
  await openVideo.click();
  await expect(dialog.getByText('Analyzing visible form…')).toBeVisible();
  finished = true;
  await expect(dialog.getByText('The hips rise.')).toBeVisible();
  await expect(dialog.getByText('Adjustment to try', { exact: true })).toHaveCount(1);
  await dialog.getByRole('button', { name: '0:00.5 · Show observation frame' }).click();
  const video = dialog.locator('video');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(0.5, 2);
  await expect(video).toBeFocused();
  const playerBounds = await video.boundingBox();
  const feedbackBounds = await dialog.getByRole('heading', { name: 'Form observations' }).boundingBox();
  expect(playerBounds).not.toBeNull();
  expect(feedbackBounds).not.toBeNull();
  expect(feedbackBounds!.x).toBeGreaterThan(playerBounds!.x + playerBounds!.width);
  await dialog.getByRole('button', { name: 'Compare 0:00 · Show comparison frame' }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(0, 2);
});

test('saved video sections switch between earlier and latest feedback', async ({ page }) => {
  const review = (startSeconds: number, summary: string) => ({
    verdict: 'no_clear_issue', summary, limitations: 'Side view.', observations: [], framesReviewed: 4,
    windowSeconds: 20, startSeconds, reviewedAt: '2026-11-13T10:00:00Z', version: 10,
  });
  const earlier = review(0, 'The first section is saved.');
  const latest = review(10, 'The later section is saved.');
  await page.goto('/form-review');
  await page.getByRole('heading', { name: 'Form review' }).waitFor();
  const id = randomUUID();
  const response = await page.request.put(`/api/clips/${id}?exercise=forearm-plank`, {
    data: await readFile('tests/fixtures/synthetic-long.mp4'),
    headers: { 'Content-Type': 'video/mp4', 'X-Clip-Name': 'two-sections.mp4' },
  });
  expect(response.ok()).toBeTruthy();
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    const workspace = await response.json();
    workspace.clips[0].review = latest;
    workspace.clips[0].reviewStatus = { state: 'complete', sequence: 2, startSeconds: 10 };
    await route.fulfill({ response, json: { ...workspace, aiAvailable: true } });
  });
  await page.route(`**/api/clips/${id}/reviews`, (route) => route.fulfill({ json: { reviews: [latest, earlier] } }));
  await page.reload();
  await page.getByRole('button', { name: 'Open video · two-sections.mp4' }).click();
  const dialog = page.getByRole('dialog');
  const sections = dialog.getByLabel('Saved review section');
  await expect(dialog.getByText(latest.summary)).toBeVisible();
  await sections.selectOption('0');
  await expect(dialog.getByText(earlier.summary)).toBeVisible();
  await expect(dialog.getByText(latest.summary)).toHaveCount(0);
  const video = dialog.locator('video');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThan(0);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 1; });
  await dialog.getByRole('button', { name: 'Choose start time' }).click();
  await dialog.getByRole('button', { name: 'Use current video time' }).click();
  await expect(dialog.getByText('Review starts at 0:01')).toBeVisible();
  await expect(dialog.getByText(earlier.summary)).toBeVisible();
  const start = dialog.getByRole('textbox', { name: 'Review start in seconds' });
  await start.fill('1.5');
  await expect(start).toHaveAttribute('aria-invalid', 'true');
  await expect(start).toHaveAccessibleDescription('Enter a whole number of seconds from 0 to 86400.');
  await expect(dialog.getByRole('button', { name: 'Analyze this section' })).toBeDisabled();
  await start.fill('9999');
  await expect(start).toHaveAccessibleDescription('Choose a starting point with at least one second of exercise footage remaining.');
  await start.fill('1');
  await expect(start).toHaveAttribute('aria-invalid', 'false');
  await expect(dialog.getByRole('button', { name: 'Analyze this section' })).toBeEnabled();
  await sections.selectOption('');
  await expect(dialog.getByText(latest.summary)).toBeVisible();
});

test('a cancelled reanalysis can be retried while keeping the previous feedback', async ({ page }) => {
  await page.goto('/form-review');
  await page.getByRole('heading', { name: 'Form review' }).waitFor();
  const id = randomUUID();
  const response = await page.request.put('/api/clips/' + id + '?exercise=push-up', {
    data: await readFile('tests/fixtures/synthetic.mp4'),
    headers: { 'Content-Type': 'video/mp4', 'X-Clip-Name': 'review-retry.mp4' },
  });
  expect(response.ok()).toBeTruthy();
  const review = {
    verdict: 'no_clear_issue', summary: 'The saved result is still here.', limitations: 'Side view.', observations: [],
    sequence: 1, version: 17, startSeconds: 0, framesReviewed: 4, windowSeconds: 20, reviewedAt: '2026-11-13T10:00:00Z',
  };
  await page.route('**/api/workspace', async (route) => {
    const snapshot = await route.fetch();
    const workspace = await snapshot.json();
    workspace.clips[0].review = review;
    workspace.clips[0].reviewStatus = { state: 'cancelled', sequence: 2, startSeconds: 0 };
    await route.fulfill({ response: snapshot, json: { ...workspace, aiAvailable: true, reviewVersion: review.version } });
  });
  await page.route('**/api/clips/*/review?background=1&refresh=1', (route) => route.fulfill({
    status: 202, json: { review, reviewStatus: { state: 'running', sequence: 3, startSeconds: 0 } },
  }));
  await page.route('**/api/clips/*/review?background=1&refresh=1', (route) => route.fulfill({
    status: 429, headers: { 'Retry-After': '2' }, json: { error: 'Analysis is busy.' },
  }), { times: 1 });
  await page.clock.install();
  await page.goto('/form-review?clip=' + id);
  const dialog = page.getByRole('dialog', { name: 'Push-Up' });
  await expect(dialog.getByText(review.summary)).toBeVisible();
  await expect(dialog.getByText('Analysis cancelled. Your video is still saved.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Retry analysis' }).click();
  await expect(dialog.getByText('Analysis is busy.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Retry shortly' })).toBeDisabled();
  await page.clock.fastForward(2100);
  const retried = page.waitForResponse((reply) => reply.url().endsWith('/review?background=1&refresh=1'));
  await dialog.getByRole('button', { name: 'Retry analysis' }).click();
  expect((await retried).status()).toBe(202);
  await expect(dialog.getByText('Analyzing visible form…')).toBeVisible();
  await expect(dialog.getByText(review.summary)).toBeVisible();
});

test('narrow desktop browser window keeps navigation and the editor usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Training overview' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: 'Form Review' })).toBeVisible();
  await page.getByRole('button', { name: 'New workout' }).click();
  const editor = page.getByRole('dialog', { name: 'Schedule a workout' });
  await expect(editor.getByRole('textbox', { name: 'Workout name' })).toBeVisible();
  const rect = await editor.boundingBox();
  expect(rect?.width).toBeLessThan(390);
  await page.keyboard.press('Escape');
  await expect(editor).not.toBeVisible();
  await nav.getByRole('link', { name: 'Exercises' }).click();
  await expect(page.getByRole('button', { name: /^Goblet Squat\s/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('AI recommendation failures leave the catalog usable and filter changes clear the previous picks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), aiAvailable: true } });
  });
  await page.route('**/api/exercises/recommendations?*', (route) => route.fulfill({
    json: [{ exerciseId: 'push-up', reason: 'A bodyweight option for chest.' }],
  }));
  await page.route('**/api/exercises/recommendations?*', (route) => route.fulfill({
    status: 503, headers: { 'Retry-After': '1' }, json: { error: 'AI temporarily unavailable.' },
  }), { times: 1 });

  await page.goto('/explore');
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('button', { name: 'Bodyweight only' }).click();
  await page.getByRole('button', { name: 'Chest', exact: true }).click();
  await page.getByRole('button', { name: 'Get AI recommendations' }).click();
  await expect(page.getByText('AI temporarily unavailable.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Push-Up Chest/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry shortly' })).toBeDisabled();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('A bodyweight option for chest.')).toBeVisible();
  await page.getByRole('button', { name: 'All muscles' }).click();
  await expect(page.getByText('A bodyweight option for chest.')).toHaveCount(0);
  await expect(page.getByText('131 exercises', { exact: true })).toBeVisible();
});

test('keyboard users can skip navigation and find the current page and filter state', async ({ page }) => {
  await page.goto('/explore');
  await expect(page.getByRole('heading', { level: 1, name: 'Exercise library' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Exercises' })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.getByRole('button', { name: 'Filters' }).press('Enter');
  const bodyweight = page.getByRole('button', { name: 'Bodyweight only' });
  await expect(bodyweight).toHaveAttribute('aria-pressed', 'false');
  await bodyweight.focus();
  await page.keyboard.press('Space');
  await expect(bodyweight).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'Progress' }).press('Enter');
  await expect(page).toHaveTitle('Progress · Liftmorrow');
  await expect(page.getByRole('main')).toBeFocused();
});

test('open browser tabs share equipment changes when local storage is blocked', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
  });
  await page.goto('/explore');
  await expect(page.getByText('689 exercises', { exact: true })).toBeVisible();
  const second = await context.newPage();
  try {
    await second.goto('/explore');
    await second.getByRole('button', { name: 'My equipment' }).click();
    const dialog = second.getByRole('dialog', { name: 'My equipment' });
    await dialog.getByRole('button', { name: 'Bodyweight only' }).click();
    await dialog.getByRole('button', { name: 'Save equipment' }).click();
    await expect(second.getByText('131 exercises', { exact: true })).toBeVisible();
    await expect(page.getByText('131 exercises', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Filters (1)' }).click();
    await expect(page.getByRole('button', { name: 'Bodyweight only' })).toHaveAttribute('aria-pressed', 'true');
  } finally { await second.close(); }
});

test('a failed workspace refresh keeps the last data and exposes a working retry', async ({ page }) => {
  await page.goto('/workouts');
  await expect(page.getByRole('heading', { name: 'Workouts', exact: true })).toBeVisible();
  await page.route('**/api/workspace', (route) => route.fulfill({
    status: 503, json: { error: 'Temporary refresh problem.' },
  }), { times: 1 });
  await page.getByRole('button', { name: 'Schedule workout', exact: true }).first().click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByText('Showing your last loaded workspace. The latest changes could not be fetched.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workouts', exact: true })).toBeVisible();
  const [recovered] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === '/api/workspace'),
    page.getByRole('button', { name: 'Refresh workspace' }).click(),
  ]);
  expect(recovered.request().headers()['if-none-match']).toMatch(/^W\/"/);
  expect(recovered.status()).toBe(304);
  await expect(page.getByRole('button', { name: 'Refresh workspace' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Workouts', exact: true })).toBeVisible();
});

test('a stale editor cannot overwrite a workout saved in another tab', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load sample workouts' }).click();
  await page.getByRole('link', { name: 'Workouts' }).click();
  await openWorkoutDetails(page, 'Upper Body Strength');
  const firstEdit = page.getByRole('button', { name: 'Edit workout · Upper Body Strength' });
  await firstEdit.click();
  const second = await context.newPage();
  try {
    await second.goto('/workouts');
    await openWorkoutDetails(second, 'Upper Body Strength');
    await second.getByRole('button', { name: 'Edit workout · Upper Body Strength' }).click();
    const next = second.getByRole('dialog');
    await next.getByRole('textbox', { name: 'Workout name' }).fill('Current workout name');
    await next.getByRole('button', { name: 'Save workout' }).click();
    await expect(second.getByRole('heading', { name: 'Current workout name' })).toBeVisible();
    const old = page.getByRole('dialog');
    await old.getByRole('textbox', { name: 'Workout name' }).fill('Stale workout name');
    await old.getByRole('button', { name: 'Save workout' }).click();
    await expect(old.getByText(/This workout changed in another tab/)).toBeVisible();
    await old.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.getByRole('heading', { name: 'Current workout name' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Stale workout name' })).toHaveCount(0);
  } finally { await second.close(); }
});

test('a workout edit can retry after its committed response is lost', async ({ page }) => {
  await page.goto('/workouts');
  await page.getByRole('heading', { name: 'Workouts', exact: true }).waitFor();
  const id = randomUUID();
  const created = await page.request.post('/api/workouts', { data: {
    id, name: 'Original plan', status: 'planned', date: '2026-11-14', time: '08:30',
    exercises: [{ exerciseId: 'push-up', sets: 3, reps: 8 }],
  } });
  expect(created.ok()).toBeTruthy();
  await page.reload();
  await openWorkoutDetails(page, 'Original plan');
  await page.getByRole('button', { name: 'Edit workout · Original plan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit workout' });
  await dialog.getByRole('textbox', { name: 'Workout name' }).fill('Revised plan');
  await page.route(new RegExp('/api/workouts/' + id + '\\?response=delta$'), async (route) => {
    const committed = await route.fetch();
    expect(committed.ok()).toBeTruthy();
    await route.abort('failed');
  }, { times: 1 });
  await dialog.getByRole('button', { name: 'Save workout' }).click();
  await expect(dialog.getByText('Could not connect. Check your connection and try again.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save workout' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Revised plan' })).toBeVisible();
  const workspace = await (await page.request.get('/api/workspace')).json();
  expect(workspace.workouts).toEqual([expect.objectContaining({ id, name: 'Revised plan', revision: 2 })]);
});
