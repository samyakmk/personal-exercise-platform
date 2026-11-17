import { expect, test } from './signed-in';

test('saving a clip avoids analysis while explicit analysis uses the preview start', async ({ page }) => {
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    if (response.status() !== 200) return route.fulfill({ response });
    return route.fulfill({ response, json: { ...await response.json(), aiAvailable: true } });
  });
  const starts: string[] = [];
  await page.route('**/api/clips/*/review?*', (route) => {
    const start = new URL(route.request().url()).searchParams.get('start') ?? '0';
    starts.push(start);
    return route.fulfill({ json: {
      reviewStatus: { state: 'complete', sequence: 1, startSeconds: Number(start) },
      review: {
        verdict: 'insufficient_visibility', summary: 'Keep both feet visible.', limitations: '',
        observations: [], framesReviewed: 4, windowSeconds: 20, startSeconds: Number(start),
        reviewedAt: '2026-11-16T18:00:00Z', sequence: 1,
        coverage: { source: 'visual', assessed: [], limits: ['This review covers one section.'], next: 'Keep both feet visible.' },
      },
    } });
  });
  await page.goto('/form-review');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/synthetic-long.mp4');
  const start = page.getByRole('textbox', { name: 'Preview review start in seconds' });
  await start.fill('10');
  await expect(page.getByText('Analyze up to 20 seconds from 0:10')).toBeVisible();
  await page.getByRole('button', { name: 'Upload video', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Saved exercise video')).toBeVisible();
  expect(starts).toEqual([]);

  await page.goto('/form-review');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/synthetic-long.mp4');
  await start.fill('10');
  await page.getByRole('button', { name: 'Upload and analyze' }).click();
  const review = page.getByRole('dialog');
  await expect(review.getByText('Keep both feet visible.')).toBeVisible();
  await expect(review.getByText('Visual assessment')).toBeVisible();
  await expect(review.getByRole('button', { name: 'Record another clip' })).toBeVisible();
  expect(starts).toEqual(['10']);
});
