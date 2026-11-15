import { test as base, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

export async function createBrowserProfile(request: APIRequestContext, origin: string, username = 'test-user') {
  const response = await request.post(new URL('/api/profiles', origin).href, { data: { username } });
  expect(response.status()).toBe(201);
}

export const test = base.extend<{ signedIn: void }>({
  signedIn: [async ({ context, baseURL }, use) => {
    await createBrowserProfile(context.request, baseURL!);
    await use();
  }, { auto: true }],
});

export { expect };
