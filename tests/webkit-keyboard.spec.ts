import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';

async function activate(control: Locator) {
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await control.press('Enter');
}

test('desktop and narrow browser widths support keyboard exercise discovery and workout saving', async ({ page }) => {
  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({
    contentType: 'text/html', body: '<button>Play demonstration</button>',
  }));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await activate(page.getByRole('button', { name: 'Explore exercises' }));
    await activate(page.getByRole('button', { name: 'Filters' }));
    await activate(page.getByRole('button', { name: 'Bodyweight only' }));
    await activate(page.getByRole('button', { name: 'Back', exact: true }));
    const search = page.getByRole('textbox', { name: 'Search exercises' });
    await search.fill('pull-up');
    await expect(page.getByText('No matching exercises')).toBeVisible();
    await activate(page.getByRole('button', { name: 'Clear filters' }));
    await activate(page.getByRole('button', { name: /^Goblet Squat\s/ }));
    const demo = page.getByRole('dialog', { name: 'Goblet Squat' });
    await expect(demo.frameLocator('iframe').getByRole('button', { name: 'Play demonstration' })).toBeVisible();
    await activate(demo.getByRole('button', { name: 'Add to workout' }));
    await activate(page.getByRole('button', { name: 'Start a new workout' }));
    const editor = page.getByRole('dialog');
    const name = `Keyboard workout ${width}`;
    await editor.getByRole('textbox', { name: 'Workout name' }).fill(name);
    await activate(editor.getByRole('button', { name: 'Save workout', exact: true }));
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name })).toBeVisible();
  }
});

test('keyboard video upload and download preserve the file and workspace privacy', async ({ page, browser }) => {
  await page.goto('/form-review');
  await page.getByLabel('Exercise in your clip').selectOption('push-up');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/synthetic.mp4');
  await activate(page.getByRole('button', { name: 'Upload video' }));
  const dialog = page.getByRole('dialog', { name: 'Push-Up' });
  await expect(dialog).toBeVisible();
  await activate(dialog.getByRole('button', { name: 'Close dialog' }));
  await expect(dialog).toBeHidden();
  await activate(page.getByRole('button', { name: 'Open video · synthetic.mp4' }));
  await expect(page).toHaveURL(/\/form-review\?clip=/);
  await page.reload();
  await expect(dialog).toBeVisible();
  const video = dialog.locator('video');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThan(0);
  await activate(dialog.getByRole('button', { name: 'Video options' }));
  const link = dialog.getByRole('link', { name: 'Download video' });
  const [download] = await Promise.all([page.waitForEvent('download'), activate(link)]);
  expect(download.suggestedFilename()).toBe('synthetic.mp4');
  const visitor = await browser.newContext();
  try {
    const url = new URL((await link.getAttribute('href'))!, page.url()).href;
    expect((await visitor.request.get(url)).status()).toBe(404);
  } finally {
    await visitor.close();
  }
});
