import { readFile } from 'node:fs/promises';
import { expect, test } from './signed-in';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
test.skip(({ browserName }) => browserName !== 'chromium', 'Uses Chromium’s synthetic camera.');

test('records a clip in Form Review and shows the matched stills on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), aiAvailable: true } });
  });
  await page.route('**/api/clips/*/review?background=1', (route) => route.fulfill({ json: {
    reviewStatus: { state: 'complete', sequence: 1, startSeconds: 0 },
    review: {
      verdict: 'observations', summary: '', limitations: '', framesReviewed: 4, windowSeconds: 20,
      reviewedAt: '2026-11-16T18:00:00Z', sequence: 1, detectedExerciseId: 'push-up',
      observations: [{ timestamp: 1, comparisonTimestamp: 0.5, kind: 'adjustment', observation: 'Your hips dropped.', cue: 'Lower your chest and hips together.' }],
      observationFrame: { reference: {
        path: '/form-reference/push-up-lowered.jpg', phase: 'Lowered position',
        source: 'https://github.com/yuhonas/free-exercise-db', credit: 'Free Exercise DB',
      } },
    },
  } }));
  const userStill = await readFile('public/form-reference/push-up-top.jpg');
  await page.route('**/api/clips/*/review-still?*', (route) => route.fulfill({ contentType: 'image/jpeg', body: userStill }));

  await page.goto('/form-review');
  await page.getByRole('button', { name: 'Record with camera' }).click();
  await expect(page.getByLabel('Live camera preview')).toBeVisible();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('timer')).toHaveText('0:18 remaining');
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: 'Use recording' }).click();
  await expect(page.getByLabel('Video preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose time range' })).toHaveCount(0);
  expect((await (await page.request.get('/api/workspace')).json()).clips).toEqual([]);

  await page.getByRole('button', { name: 'Upload and analyze' }).click();
  const review = page.getByRole('dialog');
  await expect(review.getByText('Your hips dropped.')).toBeVisible();
  const recorded = review.getByRole('img', { name: 'Your form at 0:01' });
  const reference = review.getByRole('img', { name: 'Reference form · Lowered position' });
  await expect(recorded).toBeVisible();
  await expect(reference).toBeVisible();
  await expect.poll(() => recorded.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => reference.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await expect(review.getByRole('link', { name: 'Free Exercise DB' })).toBeVisible();
  await expect.poll(async () => (await recorded.boundingBox())!.x < (await reference.boundingBox())!.x).toBe(true);
  await review.getByRole('button', { name: '0:01 · Show observation frame' }).click();
  await expect.poll(() => review.locator('video').evaluate((video) => video.currentTime)).toBeCloseTo(1, 1);
});
