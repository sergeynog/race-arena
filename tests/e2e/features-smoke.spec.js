// Maps to features.md — smoke checks against deployed or local hosting.
// BASE_URL=https://localhost:5000 npm run test:e2e  (after firebase serve)
// Default: production hosting.

const { test, expect } = require('@playwright/test');

test.describe('F-001 / F-003 guest shell', () => {
  test('index loads version footer and Lap Selector tab', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#appVersionDisplay')).toBeVisible();
    await expect(page.locator('#appVersionDisplay')).toHaveText(/\d+\.\d+\.\d+/, { timeout: 20_000 });
    await page.locator('.tab[data-tab="laps"]').click();
    await expect(page.locator('#lapTableBody')).toBeVisible();
    await expect(page.locator('#btnGoAnalysis')).toBeVisible();
  });

  test('guest can open Charts tab (empty or with laps)', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tab[data-tab="charts"]').click();
    await expect(page.locator('#chartsGrid')).toBeVisible();
  });
});

test.describe('F-003 community laps (when data exists)', () => {
  test('after cloud load, slot buttons are clickable', async ({ page }) => {
    await page.goto('/');
    await page.locator('.tab[data-tab="laps"]').click();
    await page.waitForTimeout(4000);
    const firstSlot = page.locator('#lapTableBody .slot-btn[data-slot="a"]').first();
    const count = await firstSlot.count();
    if (count === 0) {
      test.skip(true, 'No laps in project — seed community data to exercise selection');
      return;
    }
    await firstSlot.click({ timeout: 15_000 });
    await expect(page.locator('#slotAValue')).not.toContainText('Not selected');
  });
});
