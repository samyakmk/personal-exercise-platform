import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './signed-in';

test.use({
  launchOptions: async ({ browserName }, use) => use(browserName === 'chromium'
    ? { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } : {}),
});

async function startWorkout(page: Page, fakeTimers = false, lastExercise = { exerciseId: 'push-up', sets: 1, reps: 7 }) {
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
      lastExercise,
    ],
  } });
  expect(response.ok()).toBe(true);
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Start session · Guided workout' }).click();
  return page.getByRole('dialog', { name: 'Guided workout' });
}

type SpeechProbe = {
  say: (text: string, kind?: 'interim' | 'duplicate') => void;
  fail: (error: string) => void;
  finishSpeaking: () => void;
  state: () => { starts: number; listening: boolean; spoken: string };
};

async function mockWorkoutSpeech(page: Page) {
  await page.addInitScript(() => {
    let current: Microphone | undefined;
    let starts = 0;
    let utterance: { text: string; onend?: () => void } | undefined;
    class Microphone {
      onstart?: () => void;
      onend?: () => void;
      onerror?: (event: { error: string }) => void;
      onresult?: (event: { resultIndex: number; results: unknown[] }) => void;
      results: unknown[] = [];

      start() {
        current = this;
        starts++;
        this.onstart?.();
      }

      abort() {
        if (current === this) current = undefined;
        this.onend?.();
      }
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: Microphone });
    Object.defineProperty(window, 'speechSynthesis', { value: Object.assign(new EventTarget(), {
      getVoices: () => [{ localService: true, lang: 'en-US' }],
      speak: (value: typeof utterance) => { utterance = value; },
      cancel: () => { utterance = undefined; },
    }) });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class {
      constructor(readonly text: string) {}
    } });
    const probe: SpeechProbe = {
      say(text, kind) {
        if (!current) throw new Error('The microphone is idle');
        const listening = current;
        const result = { isFinal: kind !== 'interim', 0: { transcript: text } };
        const event = { resultIndex: listening.results.length, results: [...listening.results, result] };
        if (result.isFinal) listening.results.push(result);
        listening.onresult?.(event);
        if (kind === 'duplicate') listening.onresult?.(event);
      },
      fail(error) {
        const listening = current;
        listening?.onerror?.({ error });
        listening?.abort();
      },
      finishSpeaking() {
        const spoken = utterance;
        utterance = undefined;
        spoken?.onend?.();
      },
      state: () => ({ starts, listening: Boolean(current), spoken: utterance?.text ?? '' }),
    };
    Object.assign(window, { workoutSpeech: probe });
  });
  return {
    say: (text: string, kind?: 'interim' | 'duplicate') => page.evaluate(([text, kind]) =>
      (window as Window & { workoutSpeech: SpeechProbe }).workoutSpeech.say(text, kind), [text, kind] as const),
    fail: (error: string) => page.evaluate((error) =>
      (window as Window & { workoutSpeech: SpeechProbe }).workoutSpeech.fail(error), error),
    finishSpeaking: () => page.evaluate(() =>
      (window as Window & { workoutSpeech: SpeechProbe }).workoutSpeech.finishSpeaking()),
    state: () => page.evaluate(() => (window as Window & { workoutSpeech: SpeechProbe }).workoutSpeech.state()),
  };
}

test('a mobile workout keeps its action in view and uses prior actual load only on request', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post('/api/workouts', { data: {
    id: randomUUID(), name: 'Prior lifting', status: 'completed', date: '2026-11-13', time: '12:00',
    exercises: [{ exerciseId: 'goblet-squat', sets: 2, setDetails: [
      { reps: 6, load: { value: 12.5, unit: 'kg' } }, { reps: 5, load: { value: 15, unit: 'kg' } },
    ] }],
  } });
  const workout = await startWorkout(page);
  await expect(workout.getByRole('button', { name: 'I’m ready' })).toBeInViewport();
  const ready = await workout.getByRole('button', { name: 'I’m ready' }).boundingBox();
  await workout.getByRole('button', { name: 'I’m ready' }).click();
  await expect(workout.getByRole('textbox', { name: 'Reps · Goblet Squat' })).toBeInViewport();
  await expect(workout.getByRole('textbox', { name: 'Weight per dumbbell · Goblet Squat' })).toBeInViewport();
  await expect(workout.getByText('Last session · Nov 13, 2026')).toBeVisible();
  await expect(workout.getByText('6 reps · 12.5 kg per dumbbell / 5 reps · 15 kg per dumbbell')).toBeVisible();
  await expect(workout.getByRole('textbox', { name: 'Weight per dumbbell · Goblet Squat' })).toHaveValue('10');
  await workout.getByRole('button', { name: 'Use last load' }).click();
  await expect(workout.getByRole('textbox', { name: 'Weight per dumbbell · Goblet Squat' })).toHaveValue('15');
  await expect(workout.getByRole('combobox', { name: 'Unit · Goblet Squat' })).toHaveValue('kg');
  const record = workout.getByRole('button', { name: 'Record set' });
  await expect(record).toBeInViewport();
  const recordBox = await record.boundingBox();
  expect(Math.abs(recordBox!.y - ready!.y)).toBeLessThan(3);
  await record.click();
  const next = workout.getByRole('button', { name: 'Skip rest' });
  await expect(next).toBeInViewport();
  expect(Math.abs((await next.boundingBox())!.y - ready!.y)).toBeLessThan(3);
  await expect(workout.getByRole('timer')).toBeInViewport();
  await expect(workout.getByText('Sets saved on this device')).toBeVisible();
});

test('a contextual swap keeps recorded sets and persists exercise lineage', async ({ page }) => {
  const workout = await startWorkout(page);
  await workout.getByRole('button', { name: 'Rest settings' }).click();
  await workout.getByLabel('Rest between sets for this workout').selectOption('90');
  await workout.getByRole('button', { name: 'I’m ready' }).click();
  await workout.getByRole('button', { name: 'Record set' }).click();
  await expect(workout.getByRole('timer')).toHaveText(/^1:(30|29|28)$/);
  await workout.getByRole('button', { name: 'Swap exercise', exact: true }).click();
  await expect(workout.getByRole('button', { name: 'Avoid Dumbbells' })).toHaveAttribute('aria-pressed', 'true');
  const substitute = workout.getByRole('button', { name: /^Swap to / }).first();
  const replacementName = (await substitute.innerText()).replace(/^Swap to /, '');
  await substitute.click();
  await expect(workout.getByText('Replaces Goblet Squat')).toBeVisible();
  await expect(workout.getByText('1 of 4 planned sets recorded')).toBeVisible();
  await expect(workout.getByText('Get ready for ' + replacementName)).toBeVisible();
  await workout.getByRole('button', { name: 'I’m ready' }).click();
  await workout.getByRole('button', { name: 'Record set' }).click();
  await workout.getByRole('button', { name: 'Finish session' }).click();
  await workout.getByRole('button', { name: 'Save workout log' }).click();
  await expect(workout).toBeHidden();
  const { workouts } = await (await page.request.get('/api/workspace')).json();
  expect(workouts[0].exercises).toMatchObject([
    { exerciseId: 'goblet-squat', setDetails: [{ reps: 8, load: { value: 10, unit: 'lb' } }] },
    { replacesExerciseId: 'goblet-squat', setDetails: [{ reps: 8 }] },
  ]);
});

test('a confirmed set survives closing the tab and its offline finish syncs once', async ({ page, context }) => {
  const workout = await startWorkout(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller))).toBe(true);
  await workout.getByRole('button', { name: 'I’m ready' }).click();
  await workout.getByRole('textbox', { name: 'Reps · Goblet Squat' }).fill('6');
  await workout.getByRole('button', { name: 'Record set' }).click();
  await expect(workout.getByText('Sets saved on this device')).toBeVisible();

  await context.setOffline(true);
  await page.close();
  const reopened = await context.newPage();
  try {
    await reopened.clock.setFixedTime(new Date(2026, 10, 16, 12));
    await reopened.goto('/workouts');
    await reopened.getByRole('button', { name: 'Resume session · Guided workout' }).click();
    const resumed = reopened.getByRole('dialog', { name: 'Guided workout' });
    await expect(resumed.getByText('1 of 4 planned sets recorded')).toBeVisible();
    await expect(resumed.getByText('6 reps · 10 lb per dumbbell', { exact: true })).toBeVisible();
    await resumed.getByRole('button', { name: 'Finish session' }).click();
    await resumed.getByRole('button', { name: 'Save workout log' }).click();
    await expect(resumed).toBeHidden();
    await expect(reopened.getByText('Workout saved on this device. It will sync when you reconnect.')).toBeVisible();
    await reopened.reload();
    await expect(reopened.getByRole('button', { name: 'Resume session · Guided workout' })).toHaveCount(0);

    await context.setOffline(false);
    const serverWorkouts = async () => (await (await context.request.get('/api/workspace')).json()).workouts;
    await expect.poll(serverWorkouts).toMatchObject([{
      name: 'Guided workout', status: 'completed', revision: 2,
      exercises: [{ exerciseId: 'goblet-squat', setDetails: [{ reps: 6, load: { value: 10, unit: 'lb' } }] }],
    }]);
    await reopened.reload();
    await expect.poll(serverWorkouts).toHaveLength(1);
    expect((await serverWorkouts())[0].revision).toBe(2);
  } finally {
    await context.setOffline(false);
  }
});

test('retrying a finished workout after its response is lost uses the same save operation', async ({ page }) => {
  const workout = await startWorkout(page);
  const initial = (await (await page.request.get('/api/workspace')).json()).workouts[0];
  const operationIds: string[] = [];
  await page.route(`**/api/workouts/${initial.id}?response=delta`, async (route) => {
    operationIds.push(route.request().postDataJSON().operationId);
    if (operationIds.length > 1) return route.continue();
    const saved = await route.fetch();
    expect(saved.ok()).toBe(true);
    await route.abort();
  });
  await workout.getByRole('button', { name: 'I’m ready' }).click();
  await workout.getByRole('button', { name: 'Record set' }).click();
  await workout.getByRole('button', { name: 'Finish session' }).click();
  await workout.getByRole('button', { name: 'Save workout log' }).click();
  await expect(workout).toBeHidden();
  await expect(page.getByText('Workout saved on this device. It will sync when you reconnect.')).toBeVisible();
  await page.reload();
  await expect.poll(() => operationIds.length).toBe(2);
  expect(operationIds[0]).toBeTruthy();
  expect(operationIds[1]).toBe(operationIds[0]);
  const { workouts } = await (await page.request.get('/api/workspace')).json();
  expect(workouts).toMatchObject([{ id: initial.id, status: 'completed', revision: 2 }]);
});

test('coach audio reads back spoken reps and load before recording', async ({ page }) => {
  const speech = await mockWorkoutSpeech(page);
  const workout = await startWorkout(page);
  await workout.getByRole('button', { name: 'Coach audio off' }).click();
  await expect.poll(speech.state).toMatchObject({ spoken: expect.stringContaining('Goblet Squat') });
  await speech.finishSpeaking();
  await workout.getByRole('button', { name: 'Voice commands off' }).click();
  await speech.say('I am ready');
  await expect.poll(speech.state).toMatchObject({ spoken: expect.stringContaining('Set 1 of 2') });
  await speech.finishSpeaking();
  await expect.poll(speech.state).toMatchObject({ listening: true });
  await speech.say('I did six reps');
  await expect.poll(speech.state).toMatchObject({ spoken: expect.stringContaining('I entered 6 reps') });
  await speech.finishSpeaking();
  await expect.poll(speech.state).toMatchObject({ listening: true });
  await speech.say('Weight twelve point five kilograms');
  await expect.poll(speech.state).toMatchObject({ spoken: expect.stringContaining('Entered 12.5 kg per dumbbell') });
  await speech.finishSpeaking();
  await expect.poll(speech.state).toMatchObject({ listening: true });
  await speech.say('Record set');
  await expect.poll(speech.state).toMatchObject({ spoken: expect.stringContaining('Recorded 6 reps · 12.5 kg per dumbbell') });
});

test('voice commands take a guided workout from readiness through saving', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const speech = await mockWorkoutSpeech(page);
  const workout = await startWorkout(page, true, { exerciseId: 'forearm-plank', sets: 1, reps: 30 });
  await expect(workout.getByRole('button', { name: 'Voice commands off' })).toBeVisible();
  expect(await speech.state()).toMatchObject({ starts: 0, listening: false });
  await workout.getByRole('button', { name: 'Voice commands off' }).click();
  await expect(workout.getByText('Listening for commands')).toBeVisible();
  await speech.say('I’m ready', 'interim');
  await expect(workout.getByText('Get ready for Goblet Squat')).toBeVisible();
  await speech.say('I’m ready.');
  await expect(workout.getByRole('button', { name: 'Record set' })).toBeVisible();
  await speech.say('Message coach');
  await expect(workout.getByRole('textbox', { name: 'Message the coach' })).toBeVisible();
  await speech.say('Message coach, what equipment do I need?');
  await expect(workout.getByText('You · what equipment do I need?')).toBeVisible();
  await expect(workout.getByText('Get your dumbbells ready. Planned load is 10 lb per dumbbell.')).toBeVisible();
  await speech.say('I did six reps');
  await expect(workout.getByRole('textbox', { name: 'Reps · Goblet Squat' })).toHaveValue('6');
  await speech.say('Weight twelve point five kilograms');
  await expect(workout.getByRole('textbox', { name: 'Weight per dumbbell · Goblet Squat' })).toHaveValue('12.5');
  await speech.say('Record set', 'duplicate');
  await expect(workout.getByText('1 of 4 planned sets recorded')).toBeVisible();
  await speech.say('Add thirty seconds');
  await expect(workout.getByRole('timer')).toHaveText(/^1:[23]/);
  await speech.say('Skip rest');
  await expect(workout.getByText('Set 2 of 2', { exact: true })).toBeVisible();
  await speech.say('Record set');
  await expect(workout.getByText('2 of 4 planned sets recorded')).toBeVisible();
  await speech.say('Skip rest');
  await expect(workout.getByText('Get ready for Single-Arm Dumbbell Row')).toBeVisible();
  await speech.say('Skip exercise');
  await expect(workout.getByText('Get ready for Forearm Plank')).toBeVisible();
  await speech.say('I am ready');
  await expect(workout.getByRole('button', { name: 'Start hold timer' })).toBeEnabled();
  await speech.say('Start hold timer');
  const hold = page.getByRole('dialog', { name: 'Hold timer' });
  await expect(hold).toBeVisible();
  await speech.say('Record set');
  await expect(hold).toBeVisible();
  await page.clock.fastForward(10_000);
  await speech.say('Stop hold timer');
  await expect(hold).toBeHidden();
  await speech.say('I held for ten seconds');
  await expect(workout.getByRole('textbox', { name: 'Seconds · Forearm Plank' })).toHaveValue('10');
  await speech.say('Record set');
  await expect(workout.getByText('Lineup complete')).toBeVisible();
  await speech.say('Finish session');
  await expect(workout.getByRole('button', { name: 'Save workout log' })).toBeVisible();
  await speech.say('Save workout log');
  await expect(workout).toBeHidden();
  expect(await speech.state()).toMatchObject({ listening: false });

  const { workouts } = await (await page.request.get('/api/workspace')).json();
  expect(workouts[0].exercises).toMatchObject([
    { exerciseId: 'goblet-squat', setDetails: [{ reps: 6, load: { value: 12.5, unit: 'kg' } }, { reps: 8 }] },
    { exerciseId: 'forearm-plank', setDetails: [{ reps: 10 }] },
  ]);
});

test('voice commands recover after silence, pause for coach speech, and stay off after a session pause', async ({ page }) => {
  const speech = await mockWorkoutSpeech(page);
  const workout = await startWorkout(page);
  await workout.getByRole('button', { name: 'Voice commands off' }).click();
  await speech.fail('not-allowed');
  await expect(workout.getByText(/need microphone and speech recognition permission/)).toBeVisible();
  await expect(workout.getByRole('button', { name: 'I’m ready' })).toBeEnabled();
  await workout.getByRole('button', { name: 'Voice commands off' }).click();
  await speech.fail('no-speech');
  await expect(workout.getByText('Listening for commands')).toBeVisible();
  await expect.poll(speech.state).toMatchObject({ starts: 3, listening: true });

  await workout.getByRole('button', { name: 'Coach audio off' }).click();
  await expect(workout.getByText('Microphone paused while the coach speaks')).toBeVisible();
  expect(await speech.state()).toMatchObject({ listening: false, spoken: expect.stringContaining('Goblet Squat') });
  await speech.finishSpeaking();
  await expect(workout.getByText('Listening for commands')).toBeVisible();
  await speech.say('Turn off voice commands');
  await expect(workout.getByRole('button', { name: 'Voice commands off' })).toBeVisible();
  expect(await speech.state()).toMatchObject({ listening: false });
  await workout.getByRole('button', { name: 'Voice commands off' }).click();
  await speech.say('Pause session');
  await expect(workout).toBeHidden();
  expect(await speech.state()).toMatchObject({ listening: false });
  await page.getByRole('button', { name: 'Resume session', exact: true }).first().click();
  await expect(workout.getByRole('button', { name: 'Voice commands off' })).toBeVisible();
  expect(await speech.state()).toMatchObject({ starts: 5, listening: false });
  await workout.getByRole('button', { name: 'Switch to manual' }).click();
  await workout.getByRole('button', { name: 'Voice commands off' }).click();
  await speech.say('Start rest timer');
  const rest = page.getByRole('dialog', { name: 'Rest timer' });
  await expect(rest).toBeVisible();
  await speech.say('Skip rest');
  await expect(rest).toBeHidden();
  await speech.say('Record set');
  await expect(workout.getByText('1 of 4 planned sets recorded')).toBeVisible();
});

test('coach waits for readiness, carries rest across reload, and keeps skipped exercises out of the log', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const workout = await startWorkout(page, true);
  await expect(workout.getByText('Get ready for Goblet Squat')).toBeVisible();
  await expect(workout.getByRole('button', { name: 'Pause session' })).toBeInViewport();
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
  await expect(workout.getByText(/Coach reply unavailable.*dumbbells/)).toBeVisible();
  await workout.getByRole('button', { name: 'I’m ready' }).click();
  await expect(workout.getByRole('button', { name: 'Record set' })).toBeEnabled();
});

test('links a workout clip to its set and carries a form cue back into the session', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    if (response.status() === 304) return route.fulfill({ response });
    await route.fulfill({ response, json: { ...await response.json(), aiAvailable: true } });
  });
  await page.route('**/api/clips/*/review?background=1', (route) => route.fulfill({ json: {
    reviewStatus: { state: 'complete', sequence: 1, startSeconds: 0 },
    review: {
      verdict: 'observations', summary: '', limitations: '',
      framesReviewed: 4, windowSeconds: 20, reviewedAt: '2026-11-16T18:00:00Z', sequence: 1,
      observations: [{ kind: 'adjustment', timestamp: 1, comparisonTimestamp: 0.5,
        observation: 'The weight moved forward.', cue: 'Keep the weight close to your chest.' }],
    },
  } }));
  const workout = await startWorkout(page);
  await workout.getByRole('button', { name: 'I’m ready' }).click();
  await workout.getByRole('button', { name: 'Record set' }).click();
  await workout.getByRole('button', { name: 'Skip rest' }).click();
  const reps = workout.getByRole('textbox', { name: 'Reps · Goblet Squat' });
  await reps.fill('6');

  await expect(workout.getByRole('button', { name: 'Record with camera' })).toBeVisible();
  const filePicker = workout.getByRole('button', { name: 'Upload recording' });
  const chooseFile = async () => {
    const chooser = page.waitForEvent('filechooser');
    await filePicker.click();
    return chooser;
  };
  await (await chooseFile()).setFiles({ name: 'empty.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(0) });
  await expect(workout.getByRole('alert')).toHaveText('This video file is empty.');
  await expect(reps).toHaveValue('6');

  await (await chooseFile()).setFiles('tests/fixtures/synthetic.mp4');
  await expect(page.getByRole('combobox', { name: 'Exercise in your clip' })).toHaveValue('Goblet Squat');
  await expect(page.getByLabel('Video preview', { exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/workspace')).json()).clips).toEqual([]);

  await page.getByRole('button', { name: 'Upload and analyze' }).click();
  const review = page.getByRole('dialog', { name: 'Goblet Squat' });
  await expect(review.getByText('Keep the weight close to your chest.')).toBeVisible();
  expect((await (await page.request.get('/api/workspace')).json()).clips).toMatchObject([
    { exerciseId: 'goblet-squat', filename: 'synthetic.mp4',
      trainingContext: { exerciseId: 'goblet-squat', setNumber: 2, sessionId: expect.any(String) } },
  ]);
  await review.getByRole('button', { name: 'Try this cue next set' }).click();
  await expect(workout.getByText('Cue to try next set · Keep the weight close to your chest.', { exact: true })).toBeVisible();
  await expect(workout.getByText('Set 2 of 2')).toBeVisible();
  await expect(workout.getByText('1 of 4 planned sets recorded')).toBeVisible();
  await expect(reps).toHaveValue('6');
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

    expect(analyses).toBe(0);
    await page.getByRole('button', { name: 'Upload and analyze' }).click();
    const review = page.getByRole('dialog', { name: 'Goblet Squat' });
    await expect(review.getByLabel('Saved exercise video')).toBeVisible();
    const { clips } = await (await page.request.get('/api/workspace')).json();
    expect(clips).toMatchObject([{ exerciseId: 'goblet-squat' }]);
    await expect(review.getByText('Analyzing visible form…')).toBeVisible();
    expect(analyses).toBe(1);
    await review.getByRole('button', { name: 'Resume workout' }).click();
    await expect(workout.getByRole('textbox', { name: 'Reps · Goblet Squat' })).toHaveValue('8');
    await workout.getByRole('button', { name: 'Record set' }).click();
    await expect(workout.getByText('Take a break')).toBeVisible();
  });
});
