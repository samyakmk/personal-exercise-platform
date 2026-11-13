import { expect, test } from '@playwright/test';

test('filters, empty state, saved gear, and the YouTube demonstration', async ({ page }) => {
  // The player shell is exercised deterministically. YouTube owns the external playback boundary.
  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<button>Play demonstration</button>',
  }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Training overview' })).toBeVisible();
  await page.getByRole('button', { name: 'Explore exercises' }).click();
  await expect(page.getByText('6 exercises', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bodyweight only' }).click();
  await expect(page.getByText('3 exercises', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('No matching exercises')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('button', { name: 'My equipment', exact: true }).click();
  const equipment = page.getByRole('dialog', { name: 'My equipment' });
  await equipment.getByRole('button', { name: 'Dumbbells', exact: true }).click();
  await equipment.getByRole('button', { name: 'Save equipment' }).click();
  await expect(page.getByText('4 exercises', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('4 exercises', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search exercises' }).fill('goblet');
  const card = page.getByRole('button', { name: 'Watch Goblet Squat demonstration' });
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

test('creates and edits a workout from Explore, logs actual sets, and deletes it', async ({ page }) => {
  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/explore');
  await page.getByRole('button', { name: 'Watch Goblet Squat demonstration' }).click();
  await page.getByRole('button', { name: 'Add to workout' }).click();
  await page.getByRole('button', { name: 'Start a new workout' }).click();
  let editor = page.getByRole('dialog');
  await editor.getByRole('textbox', { name: 'Workout name' }).fill('Strength practice');
  await editor.getByLabel('Choose an exercise').selectOption('forearm-plank');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Seconds · Forearm Plank' }).fill('35');
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Strength practice' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Edit Strength practice' }).click();
  editor = page.getByRole('dialog');
  await editor.getByRole('textbox', { name: 'Workout name' }).fill('Strength practice revised');
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
  await page.getByRole('button', { name: 'Log Strength practice revised' }).click();
  await editor.getByRole('textbox', { name: 'Sets · Goblet Squat' }).fill('2');
  await editor.getByRole('textbox', { name: 'Reps · Goblet Squat' }).fill('8');
  await editor.getByRole('button', { name: 'Save workout log' }).click();
  await expect(page.getByText('2 × 8 reps', { exact: true })).toBeVisible();
  await expect(page.getByText('3 × 35 sec', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByText('Workouts logged', { exact: true }).locator('..')).toContainText('4');
  await page.getByRole('link', { name: 'Workouts', exact: true }).click();
  await page.getByRole('button', { name: 'History (4)' }).click();
  await page.getByRole('button', { name: 'Edit Strength practice revised' }).click();
  await editor.getByRole('button', { name: 'Delete workout' }).click();
  await editor.getByRole('button', { name: 'Delete workout' }).click();
  await expect(page.getByRole('heading', { name: 'Strength practice revised' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'History (3)' })).toBeVisible();
});

test('previews an upload, retries an API error, reopens privately, and deletes the video', async ({ page, browser }) => {
  await page.goto('/form-review');
  await page.getByLabel('Exercise in your clip').selectOption('goblet-squat');
  const input = page.locator('input[type=file]');
  await input.setInputFiles({ name: 'text.txt', mimeType: 'text/plain', buffer: Buffer.from('not a video') });
  await expect(page.getByText('Choose an MP4 or WebM video.')).toBeVisible();
  await input.setInputFiles('tests/fixtures/synthetic.mp4');
  const preview = page.locator('video[aria-label="Video preview"]');
  await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(0);

  await page.route(/\/api\/clips\/[^/]+\?exercise=/, (route) => route.fulfill({
    status: 503, json: { error: 'Temporary upload problem. Try again.' },
  }), { times: 1 });
  await page.getByRole('button', { name: 'Upload video', exact: true }).click();
  await expect(page.getByText('Temporary upload problem. Try again.')).toBeVisible();
  await page.getByRole('button', { name: 'Upload video', exact: true }).click();
  await expect(page.getByText('Video saved to your workspace.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open synthetic.mp4' }).click();
  const saved = page.locator('video[aria-label="Saved exercise video"]');
  await expect.poll(() => saved.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(0);
  const clipUrl = await saved.evaluate((video: HTMLVideoElement) => video.src);
  const visitor = await browser.newContext();
  try {
    const outsider = await visitor.request.get(clipUrl);
    expect(outsider.status()).toBe(404);
  } finally {
    await visitor.close();
  }
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete video' }).click();
  await dialog.getByRole('button', { name: 'Delete video' }).click();
  await expect(page.getByText('No videos yet')).toBeVisible();
  expect((await page.request.get(clipUrl)).status()).toBe(404);
  await page.getByRole('button', { name: 'View example feedback' }).click();
  await expect(page.getByText(/This example is sample data/)).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Watch Goblet Squat demonstration' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
