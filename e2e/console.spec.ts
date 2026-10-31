import { expect, test } from '@playwright/test';
import { hold, login, waitForPhase } from './helpers';

test.describe.configure({ mode: 'serial' });

test('首页可一键进入交互演示', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /看得见导管/ })).toBeVisible();
  await page.getByRole('button', { name: /进入 2 分钟实操/ }).click();
  await expect(page).toHaveURL(/\/case\/case-1031\/procedure\?demo=1/);
  await expect(page.locator('.demo-coach')).toBeVisible();
  await waitForPhase(page, '已配准');
});

test('登录后加载三个演示病例', async ({ page }) => {
  await login(page, '术者');
  await expect(page.locator('.cases-table tbody tr')).toHaveCount(3);
  await expect(page.locator('body')).toContainText('C-2026-1031');
  await expect(page.locator('body')).toContainText('C-2026-1032');
  await expect(page.locator('body')).toContainText('C-2026-1033');
});

test('术者审核签字 LCX 计划并可进入术中', async ({ page }) => {
  await login(page, '术者');
  await page.goto('/case/case-1032/plan');
  await expect(page.locator('body')).toContainText('LCX');

  const sign = page.getByRole('button', { name: '审核签字', exact: true });
  await expect(sign).toBeVisible();
  await sign.click();

  const modal = page.locator('.modal');
  await expect(modal).toContainText('计划审核签字');
  await modal.locator('input[type="password"]').fill('2468');
  await modal.getByRole('button', { name: '确认签字' }).click();

  await expect(page.locator('body')).toContainText('已审核');
  await expect(page.getByRole('button', { name: /进入术中/ }).first()).toBeEnabled();
});

test('预检 → 双人武装 → 自动运行 → 暂停 → 急停复位 → 中止 → 复盘', async ({ page }) => {
  await login(page, '术者');
  await page.goto('/case/case-1031/procedure');
  await waitForPhase(page, '已配准');

  await page.getByRole('button', { name: '运行预检' }).first().click();
  await expect(page.locator('.precheck-summary.is-pass')).toContainText('全部通过', {
    timeout: 15_000,
  });

  await page.getByRole('button', { name: '双人确认武装' }).click();
  const armModal = page.locator('.modal');
  await expect(armModal).toContainText('双人确认武装');
  await armModal.locator('input[type="password"]').fill('1357');
  await armModal.getByRole('button', { name: '确认武装' }).click();
  await waitForPhase(page, '已武装');

  await page.getByRole('button', { name: '启动自动导航' }).click();
  const startModal = page.locator('.modal');
  await startModal.locator('input[type="checkbox"]').check();
  await hold(page, startModal.getByRole('button', { name: /按住 0.8 s 启动/ }));
  await waitForPhase(page, '自动运行', 20_000);

  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await waitForPhase(page, '自动暂停');

  await hold(page, page.locator('.estop-fab__button'), 800);
  await expect(page.locator('body')).toContainText('软件急停已锁定');

  await page.getByRole('button', { name: '复位急停', exact: true }).click();
  const resetModal = page.locator('.modal');
  await resetModal.locator('input[type="checkbox"]').check();
  await resetModal.getByRole('button', { name: '确认复位' }).click();
  await expect(page.locator('body')).not.toContainText('软件急停已锁定');

  await page.getByRole('button', { name: '中止并回撤' }).click();
  const abortModal = page.locator('.modal');
  await expect(abortModal).toContainText('中止并回撤');
  await hold(page, abortModal.getByRole('button', { name: /按住 0.8 s 中止/ }));
  await waitForPhase(page, '已中止', 25_000);

  await page.getByRole('button', { name: '查看复盘' }).click();
  await expect(page).toHaveURL(/\/review/);
  await expect(page.locator('body')).toContainText('已中止');
});

test('复盘归档可播放，审计链校验通过', async ({ page }) => {
  await login(page, '术者');
  await page.goto('/case/case-1033/review?session=session-case-1033');
  await expect(page.locator('body')).toContainText('RCA 慢性完全闭塞');
  await expect(page.locator('body')).toContainText('已完成');
  await expect(page.locator('body')).toContainText('遥测曲线');

  const verify = await page.request.get('/api/v1/audit/verify');
  expect(verify.ok()).toBe(true);
  const body = (await verify.json()) as { valid: boolean; count: number };
  expect(body.valid).toBe(true);
  expect(body.count).toBeGreaterThan(5);
});
