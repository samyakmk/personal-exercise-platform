import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './signed-in';

test.use({
  launchOptions: async ({ browserName }, use) => use(browserName === 'chromium'
    ? { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } : {}),
});

async function startWorkout(page: Page, fakeTimers = false) {
  const now = new Date(2026, 10, 16, 12);
  if (fakeTimers) await page.clock.install({ time: now });
  else await page.clock.setFixedTime(now);
  const response = await page.request.post('/api/workouts', { data: {
    id: randomUUID(),
    name: 'Guided workout',
    status: 'planned',
    date: '2026-11-16',
    time: '12:00',
    exercises: [
      { exerciseId: 'goblet-squat', sets: 2, reps: 8, load: { value: 10, unit: 'lb' } },
      { exerciseId: 'dumbbell-row', sets: 1, reps: 9 },
      { exerciseId: 'push-up', sets: 1, reps: 7 },
    ],
  } });
  expect(response.ok()).toBe(true);
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Start session · Guided workout' }).click();
  return page.getByRole('dialog', { name: 'Guided workout' });
}

test('coach waits for readiness, carries rest across reload, and keeps skipped exercises out of the log', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const workout = await startWorkout(page, true);
  await expect(workout.getByText('Get ready for Goblet Squat')).toBeVisible();
  await expect(workout.getByText(/dumbbells ready.*10 lb per dumbbell/)).toBeVisible();
  await expect(workout.getByRole('button', { name: 'Record set' })).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelector('dialog')!.scrollWidth)).toBeLessThanOrEqual(364);

  await workout.getByRole('button', { name: 'Message coach' }).click();
  const message = workout.getByRole('textbox', { name: 'Message the coach' });
  await message.fill('Okay, I am ready!');
  await message.press('Enter');
  await expect(workout.getByText('Set 1 of 2')).toBeVisible();
  await workout.getByRole('button', { name: 'Message coach' }).click();
  await message.fill('I did 6 reps');
  await message.press('Enter');
  await expect(workout.getByText(/I entered 6 reps/)).toBeVisible();
  await expect(workout.getByRole('textbox', { name: 'Reps · Goblet Squat' })).toHaveValue('6');
  await workout.getByRole('button', { name: 'Record set' }).click();
  await expect(workout.getByRole('timer')).toHaveText(/^(?:0:5[7-9]|1:00)$/);
  await workout.getByRole('button', { name: 'Add 30 seconds' }).click();
  await expect(workout.getByRole('timer')).toHaveText(/^1:(?:2[5-9]|30)$/);
  await workout.getByRole('button', { name: 'Pause session' }).click();
  await page.reload();

  await page.getByRole('button', { name: 'Resume session', exact: true }).first().click();
  await expect(workout.getByRole('timer')).toHaveText(/^1:(?:2[5-9]|30)$/);
  await page.clock.fastForward(91_000);
  await expect(workout.getByText('Rest complete')).toBeVisible();
  await expect(workout.getByRole('button', { name: 'Record set' })).toHaveCount(0);
  await workout.getByRole('button', { name: 'I’m ready' }).click();
  await expect(workout.getByText('Set 2 of 2')).toBeVisible();
  await workout.getByRole('button', { name: 'Record set' }).click();
  await workout.getByRole('button', { name: 'Skip rest' }).click();
  await expect(workout.getByText('Get ready for Single-Arm Dumbbell Row')).toBeVisible();
  await workout.getByRole('button', { name: 'Skip exercise' }).click();
  await expect(workout.getByText('Get ready for Push-Up')).toBeVisible();
  await workout.getByRole('button', { name: 'I’m ready' }).click();
  await workout.getByRole('button', { name: 'Record set' }).click();
  await expect(workout.getByText('Lineup complete')).toBeVisible();
  await workout.getByRole('button', { name: 'Finish session' }).click();
  await workout.getByRole('button', { name: 'Save workout log' }).click();
  await expect(workout).toBeHidden();

  const { workouts } = await (await page.request.get('/api/workspace')).json();
  expect(workouts[0].exercises).toMatchObject([
    { exerciseId: 'goblet-squat', setDetails: [{ reps: 6, load: { value: 10, unit: 'lb' } }, { reps: 8 }] },
    { exerciseId: 'push-up', setDetails: [{ reps: 7 }] },
  ]);
});

test('coach answers grounded questions and the workout proceeds after an AI request fails', async ({ page }) => {
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), aiAvailable: true } });
  });
  const questions: unknown[] = [];
  await page.route('**/api/session-coach', async (route) => {
    questions.push(route.request().postDataJSON());
    if (questions.length === 1) await route.fulfill({ json: { reply: 'Keep your elbows close to your body.' } });
    else await route.fulfill({ status: 503, json: { error: 'Unavailable' } });
  });
  const workout = await startWorkout(page);
  await workout.getByRole('button', { name: 'Message coach' }).click();
  const message = workout.getByRole('textbox', { name: 'Message the coach' });
  await message.fill('I did 6 reps');
  await message.press('Enter');
  await expect(workout.getByText('You can report reps or hold time when the next set starts.')).toBeVisible();
  expect(questions).toHaveLength(0);
  await message.fill('Where should my elbows go?');
  await workout.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(workout.getByText('Keep your elbows close to your body.')).toBeVisible();
  expect(questions).toEqual([{
    exerciseId: 'goblet-squat', phase: 'setup', setNumber: 1, question: 'Where should my elbows go?',
    target: { reps: 8, load: { value: 10, unit: 'lb' } },
  }]);
  await message.fill('What equipment do I need?');
  await workout.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(workout.getByText(/AI reply unavailable.*dumbbells/)).toBeVisible();
  await workout.getByRole('button', { name: 'I’m ready' }).click();
  await expect(workout.getByRole('button', { name: 'Record set' })).toBeEnabled();
});

test.describe('workout camera', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Synthetic camera launch options require Chromium.');

  test('camera denial leaves the workout usable and sends no video', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
        throw new DOMException('Denied', 'NotAllowedError');
      } });
    });
    const workout = await startWorkout(page);
    await workout.getByRole('button', { name: 'Record with camera' }).click();
    await expect(workout.getByText(/Camera permission was denied/)).toBeVisible();
    await workout.getByRole('button', { name: 'Close camera' }).click();
    await workout.getByRole('button', { name: 'I’m ready' }).click();
    await workout.getByRole('button', { name: 'Record set' }).click();
    await expect(workout.getByText('Take a break')).toBeVisible();
    expect((await (await page.request.get('/api/workspace')).json()).clips).toEqual([]);
  });

  test('records silently, stages a clip for form analysis, and resumes the same workout', async ({ page }) => {
    await page.route('**/api/workspace', async (route) => {
      const response = await route.fetch();
      if (response.status() === 304) return route.fulfill({ response });
      await route.fulfill({ response, json: { ...await response.json(), aiAvailable: true } });
    });
    let analyses = 0;
    await page.route('**/api/clips/*/review?background=1', (route) => {
      analyses += 1;
      return route.fulfill({ status: 202, json: { review: null, reviewStatus: { state: 'running', sequence: 1, startSeconds: 0 } } });
    });
    await page.addInitScript(() => {
      const openCamera = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async (constraints: MediaStreamConstraints) => {
        const stream = await openCamera(constraints);
        Object.assign(window, { sampleCamera: { constraints, stream } });
        return stream;
      } });
    });
    const workout = await startWorkout(page);
    await workout.getByRole('button', { name: 'I’m ready' }).click();
    await workout.getByRole('button', { name: 'Record with camera' }).click();
    const camera = workout.getByLabel('Live camera preview');
    await expect(camera).toBeVisible();
    await workout.getByRole('button', { name: 'Start recording' }).click();
    await expect(workout.getByText('Get in position')).toBeVisible();
    await expect(workout.getByRole('button', { name: 'Stop recording' })).toBeVisible({ timeout: 8_000 });
    await expect(workout.getByRole('timer')).toHaveText(/^0:1[5-8] remaining$/, { timeout: 6_000 });
    await workout.getByRole('button', { name: 'Stop recording' }).click();
    await expect(workout.getByLabel('Recorded clip preview')).toBeVisible();
    expect(await page.evaluate(() => {
      const { sampleCamera } = window as unknown as { sampleCamera: { constraints: MediaStreamConstraints; stream: MediaStream } };
      return { audio: sampleCamera.constraints.audio, audioTracks: sampleCamera.stream.getAudioTracks().length,
        ended: sampleCamera.stream.getVideoTracks().every((track) => track.readyState === 'ended') };
    })).toEqual({ audio: false, audioTracks: 0, ended: true });
    await workout.getByRole('button', { name: 'Continue to form review' }).click();
    await expect(page.getByRole('heading', { name: 'Form review' })).toBeVisible();
    await expect(page.getByLabel('Video preview')).toBeVisible();
    expect((await (await page.request.get('/api/workspace')).json()).clips).toEqual([]);

    await page.getByRole('button', { name: 'Upload video', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Goblet Squat' });
    await expect(review.getByLabel('Saved exercise video')).toBeVisible();
    expect(analyses).toBe(0);
    const { clips } = await (await page.request.get('/api/workspace')).json();
    expect(clips).toMatchObject([{ exerciseId: 'goblet-squat', reviewStatus: { state: 'idle' } }]);
    await review.getByRole('button', { name: 'Analyze form' }).click();
    await expect(review.getByText('Analyzing visible form…')).toBeVisible();
    expect(analyses).toBe(1);
    await review.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Resume workout' }).click();
    await expect(workout.getByRole('textbox', { name: 'Reps · Goblet Squat' })).toHaveValue('8');
    await workout.getByRole('button', { name: 'Record set' }).click();
    await expect(workout.getByText('Take a break')).toBeVisible();
  });
});
