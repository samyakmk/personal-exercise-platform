import { expect, test } from './signed-in';

test('upload actions work with automatic or custom review times', async ({ page }) => {
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    if (response.status() !== 200) return route.fulfill({ response });
    return route.fulfill({ response, json: { ...await response.json(), aiAvailable: true } });
  });
  const ranges: { start: number; end?: number }[] = [];
  await page.route('**/api/clips/*/review?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const startSeconds = Number(params.get('start') ?? 0);
    const endSeconds = params.has('end') ? Number(params.get('end')) : undefined;
    ranges.push({ start: startSeconds, end: endSeconds });
    return route.fulfill({ json: {
      reviewStatus: { state: 'complete', sequence: 1, startSeconds, endSeconds },
      review: {
        verdict: 'insufficient_visibility', summary: 'Keep both feet visible.', limitations: '',
        observations: [], framesReviewed: 4, windowSeconds: endSeconds === undefined ? 20 : endSeconds - startSeconds,
        startSeconds, endSeconds,
        reviewedAt: '2026-11-16T18:00:00Z', sequence: 1,
        coverage: { source: 'visual', assessed: [], limits: ['This review covers one section.'], next: 'Keep both feet visible.' },
      },
    } });
  });
  await page.goto('/form-review');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/synthetic-long.mp4');
  const analyze = page.getByRole('button', { name: 'Upload and analyze' });
  const options = page.getByRole('button', { name: 'Choose time range' });
  const start = page.getByRole('textbox', { name: 'Start time (seconds)' });
  const end = page.getByRole('textbox', { name: 'End time (seconds)' });
  await expect(analyze).toBeEnabled();
  await expect(options).toHaveAttribute('aria-expanded', 'false');
  await expect(start).toHaveCount(0);
  await expect(end).toHaveCount(0);
  expect((await analyze.boundingBox())!.y).toBeLessThan((await options.boundingBox())!.y);
  await page.getByRole('button', { name: 'Upload video', exact: true }).click();
  const review = page.getByRole('dialog');
  await expect(review.getByLabel('Saved exercise video')).toBeVisible();
  expect(ranges).toEqual([]);

  await page.goto('/form-review');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/synthetic-long.mp4');
  await analyze.click();
  await expect(review.getByText('Keep both feet visible.')).toBeVisible();
  expect(ranges).toEqual([{ start: 0, end: undefined }]);

  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/form-review');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/synthetic-long.mp4');
  await options.click();
  await start.fill('10');
  await end.fill('5');
  await expect(end).toHaveAccessibleDescription('End time must be after start time.');
  await expect(analyze).toBeDisabled();
  await end.fill('15');
  await page.getByRole('button', { name: 'Time range · 0:10–0:15' }).click();
  await expect(end).toHaveCount(0);
  await analyze.click();
  await expect(review.getByText('Keep both feet visible.')).toBeVisible();
  await expect(review.getByRole('button', { name: 'Record another clip' })).toBeVisible();
  await expect(review.getByText(/frames from up to|Visual assessment/)).toHaveCount(0);
  expect(ranges).toEqual([{ start: 0, end: undefined }, { start: 10, end: 15 }]);
});
