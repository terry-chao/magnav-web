import { expect, type Locator, type Page } from '@playwright/test';

export async function login(page: Page, role: '术者' | '助手' | '工程师' | '技师' | '审核' = '术者') {
  await page.goto('/login');
  await page.locator('.login__account').filter({ hasText: role }).click();
  await page.getByRole('button', { name: '进入控制台' }).click();
  await expect(page).toHaveURL(/\/cases/);
  await expect(page.locator('.cases-table tbody tr').first()).toBeVisible();
}

export async function hold(page: Page, locator: Locator, ms = 950) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('hold target has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

export async function phaseLabel(page: Page): Promise<string> {
  return (await page.locator('.procedure-head .phase-chip').innerText()).trim();
}

export async function waitForPhase(page: Page, label: string, timeout = 15_000) {
  await expect(page.locator('.procedure-head .phase-chip')).toContainText(label, { timeout });
}
