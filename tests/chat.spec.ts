import { expect, test } from './signed-in';

test('the full-page chat keeps its conversation across navigation and saves only confirmed notes', async ({ page }) => {
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    if (response.status() !== 200) return route.fulfill({ response });
    return route.fulfill({ response, json: { ...await response.json(), aiAvailable: true } });
  });
  const message = 'My trainer wants me to avoid bodyweight squats.';
  const reply = 'I can suggest other movements that fit your equipment.';
  let sent = 0;
  await page.route('**/api/chat?*', async (route) => {
    const input = route.request().postDataJSON();
    if (input.message === 'What should I try instead?') {
      expect(input.history).toEqual([{ role: 'user', text: message }, { role: 'assistant', text: reply }]);
      return route.fulfill({ json: { reply: 'You could try a glute bridge.' } });
    }
    expect(input.message).toBe(message);
    if (++sent === 1) return route.fulfill({ status: 503, json: { error: 'Chat is temporarily unavailable.' } });
    return route.fulfill({ json: { reply, note: { text: message, kind: 'avoid', exerciseId: 'bodyweight-squat' } } });
  });
  await page.goto('/sessions');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('link', { name: 'Chat', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Chat', exact: true })).toHaveAttribute('aria-current', 'page');
  const composer = page.getByRole('textbox', { name: 'Message' });
  await page.getByRole('button', { name: 'Share trainer feedback' }).click();
  await expect(composer).toHaveValue('My trainer suggested ');
  await composer.fill(message);
  await composer.press('Enter');
  await expect(page.getByText('Chat is temporarily unavailable.')).toBeVisible();
  await expect(composer).toBeFocused();
  await page.getByRole('button', { name: 'Retry message' }).click();
  await expect(page.getByText(reply)).toBeVisible();
  await expect(page.getByText('Keep this training note?')).toBeVisible();
  await nav.getByRole('link', { name: 'Profile' }).click();
  await expect(page.getByText('No notes yet.', { exact: false })).toBeVisible();
  await nav.getByRole('link', { name: 'Chat', exact: true }).click();
  await expect(page.getByText(reply)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole('button', { name: 'Save to profile' }).click();
  await expect(page.getByText('Saved to your profile')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const send = page.getByRole('button', { name: 'Send', exact: true });
  const bounds = await send.boundingBox();
  expect(bounds && bounds.y + bounds.height).toBeLessThanOrEqual(800);
  await composer.fill('What should I try');
  await composer.press('Shift+Enter');
  await expect(composer).toHaveValue('What should I try\n');
  await composer.fill('What should I try instead?');
  await send.click();
  await expect(page.getByText('You could try a glute bridge.')).toBeVisible();
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toBeVisible();
  await nav.getByRole('button', { name: 'More' }).click();
  await page.getByRole('dialog', { name: 'More' }).getByRole('link', { name: 'Profile' }).click();
  await page.reload();
  await expect(page.getByText(message)).toBeVisible();
  await page.getByRole('button', { name: 'Remove training note 1' }).click();
  await expect(page.getByText('No notes yet.', { exact: false })).toBeVisible();
});

test('Chat shows an unavailable state when replies are disabled', async ({ page }) => {
  await page.goto('/chat');
  await expect(page.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
  await expect(page.getByText('Chat is currently unavailable.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
});

test('weight lookup reads the logged sets and links to the source with the AI provider disabled', async ({ page }) => {
  const id = '43866a06-6258-4132-9c25-8767c280da95';
  const saved = await page.request.post('/api/workouts', { data: {
    id, name: 'Curl session', date: '2026-01-02', time: '09:00', status: 'completed',
    exercises: [{ exerciseId: 'dumbbell-curl', setDetails: [{ reps: 8, load: { unit: 'lb', value: 25 } }] }],
  } });
  expect(saved.ok()).toBeTruthy();
  await page.goto('/chat');
  await page.getByRole('button', { name: 'Look up a weight' }).click();
  const lookup = page.getByRole('dialog', { name: 'Look up a weight' });
  await lookup.getByRole('combobox', { name: 'Exercise you logged' }).fill('curl');
  await lookup.getByRole('option', { name: 'Single-Arm Dumbbell Curl' }).click();
  await lookup.getByRole('button', { name: 'Find weight' }).click();
  await expect(lookup.getByText(/25 lb per dumbbell/)).toBeVisible();
  await expect(lookup.getByRole('link', { name: 'Curl session · 2026-01-02' })).toHaveAttribute('href', `/sessions?session=${id}`);
});
