import { test, expect } from '@playwright/test';
import { NAMES, open, importNames, enterScore, genTournament } from './helpers.js';

const style = (loc, prop) => loc.evaluate((el, p) => getComputedStyle(el)[p], prop);

test.describe('試合の状態バッジ・総当たり表の記号', () => {
  test('トーナメントの試合結果一覧: 4種類の状態が、文字と枠の形でも区別できる', async ({ page }) => {
    await open(page);
    await importNames(page, NAMES.slice(0, 6));
    await genTournament(page);
    const rows = page.locator('table.results tbody');
    // 試合待ち（青の塗り・白文字）
    const ready = rows.locator('.badge-ready').first();
    await expect(ready).toHaveText('試合待ち');
    expect(await style(ready, 'backgroundColor')).toBe('rgb(29, 95, 191)');
    expect(await style(ready, 'color')).toBe('rgb(255, 255, 255)');
    expect(await style(ready, 'fontSize')).toBe('12px');
    // 対戦者未定（点線の枠）
    const waiting = rows.locator('.badge-waiting').first();
    await expect(waiting).toHaveText('対戦者未定');
    expect(await style(waiting, 'borderTopStyle')).toBe('dashed');
    // 不戦（枠なし・文字だけ）
    const bye = rows.locator('.badge-bye').first();
    await expect(bye).toHaveText('不戦');
    expect(await style(bye, 'borderTopWidth')).toBe('0px');
    expect(await style(bye, 'backgroundColor')).toBe('rgba(0, 0, 0, 0)');
    // 結果を入れると、終了（灰の枠）になる
    await page.locator('.next-item').first().click();
    await enterScore(page, 3, 1);
    const done = rows.locator('.badge-done').first();
    await expect(done).toHaveText('終了');
    expect(await style(done, 'borderTopStyle')).toBe('solid');
    expect(await style(done, 'backgroundColor')).toBe('rgba(0, 0, 0, 0)');
  });

  test('総当たり: 勝ち「○ 3-1」・負け「× 1-3」・引き分け「△ 2-2」、未入力は空欄。結果一覧にも同じバッジ', async ({ page }) => {
    await open(page);
    await importNames(page, NAMES.slice(0, 3));
    await page.click('[data-act=gen-league]');
    const cell = (r, c) => page.locator('table.matrix tbody tr').nth(r).locator('td').nth(c);
    await expect(page.locator('table.results .badge-ready')).toHaveCount(3);
    // 未入力のマスは空欄（記号も「・」も出さない）
    await expect(cell(0, 1)).toHaveText('');
    await expect(cell(1, 0)).toHaveText('');
    await cell(0, 1).click();
    const left = await page.locator('#rd-p1').textContent();
    if (left === NAMES[0]) await enterScore(page, 3, 1); else await enterScore(page, 1, 3);
    await expect(cell(0, 1)).toHaveText('○ 3-1');
    await expect(cell(1, 0)).toHaveText('× 1-3');
    await cell(0, 2).click();
    await enterScore(page, 2, 2);
    await expect(cell(0, 2)).toHaveText('△ 2-2');
    await expect(cell(2, 0)).toHaveText('△ 2-2');
    await expect(page.locator('table.results .badge-done')).toHaveCount(2);
    await expect(page.locator('table.results .badge-ready')).toHaveCount(1);
  });

  test('色がなくても（グレースケールでも）状態と勝敗が文字・記号で読み取れる', async ({ page }) => {
    await open(page);
    await importNames(page, NAMES.slice(0, 3));
    await page.click('[data-act=gen-league]');
    // インラインの <style> は CSP で塞がれるため、要素の style を直接設定する（CSSOM は CSP の対象外）
    await page.evaluate(() => { document.documentElement.style.filter = 'grayscale(1)'; });
    const cell = (r, c) => page.locator('table.matrix tbody tr').nth(r).locator('td').nth(c);
    await cell(0, 1).click();
    const left = await page.locator('#rd-p1').textContent();
    if (left === NAMES[0]) await enterScore(page, 3, 1); else await enterScore(page, 1, 3);
    // 状態は文字で、勝敗は記号で示されている（色の情報に頼らない）
    await expect(page.locator('table.results .badge-done')).toHaveText(['終了']);
    await expect(page.locator('table.results .badge-ready')).toHaveText(['試合待ち', '試合待ち']);
    await expect(cell(0, 1)).toContainText('○');
    await expect(cell(1, 0)).toContainText('×');
  });
});
