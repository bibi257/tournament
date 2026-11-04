import { test, expect } from '@playwright/test';
import { NAMES, acceptDialogs, open, importNames, enterScore, genTournament, download } from './helpers.js';

// CSP（index.html の meta）で、主要な流れがブロックされないことを確かめる（PR3・D62）。
// 違反は securitypolicyviolation で集め、0 件であることを確認する
const WATCH = () => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
};
async function violations(page) {
  return page.evaluate(() => window.__csp);
}

test.describe('CSP の違反が 0 件（主要な流れ）', () => {
  test('表の作成・結果入力・CSV/PNG 出力・呼び出し画面', async ({ page }) => {
    await page.addInitScript(WATCH);
    acceptDialogs(page);
    await open(page);
    await importNames(page, NAMES.slice(0, 4));
    await genTournament(page);
    await page.locator('.next-item').first().click();
    await enterScore(page, 3, 1);
    expect(await download(page, '[data-export=bracket-csv]')).toBeTruthy();
    await download(page, '[data-export=bracket-png]');
    // 遷移すると違反の記録は作り直されるので、遷移の前後を合わせて確かめる
    const before = await violations(page);
    await page.goto('/?view=call');
    await page.waitForLoadState('load');
    expect([...before, ...(await violations(page))]).toEqual([]);
  });
});

test.describe('CSP の違反が 0 件（共有・QR）', () => {
  test.use({ baseURL: 'http://localhost:4174/' });
  test('共有の作成と QR コードの表示', async ({ page }) => {
    await page.addInitScript(WATCH);
    acceptDialogs(page);
    await open(page);
    await importNames(page, NAMES.slice(0, 4));
    await genTournament(page);
    await page.click('[data-action=share]');
    await page.fill('#sh-apw', 'admin-pass-1');
    await page.fill('#sh-apwc', 'admin-pass-1');
    await page.click('[data-sh=start]');
    await expect(page.locator('.sh-code')).toHaveText(/^[a-hj-km-np-z2-9]{8}$/);
    await page.click('[data-sh=qr]');
    await expect(page.locator('#qr-dialog')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
});
