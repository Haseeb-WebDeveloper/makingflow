import { expect, test } from '@playwright/test'

// Smoke test — proves the app boots and serves the homepage.
test('homepage responds', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.ok()).toBeTruthy()
})
