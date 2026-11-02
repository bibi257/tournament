import { test, expect } from '@playwright/test';
import { open, importNames, acceptDialogs, enterScore } from './helpers.js';

const FOUR = ['山田 太郎', '佐藤 花子', '鈴木 一郎', '高橋 次郎'];
const active = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return { tag: el.tagName, r: el.dataset?.r ?? null, c: el.dataset?.c ?? null, match: el.dataset?.match ?? null, label: el.getAttribute('aria-label') };
});
const at = async (page) => { const a = await active(page); return `${a.r},${a.c}`; };

async function makeLeague(page, names = FOUR) {
  await open(page);
  await importNames(page, names);
  await page.click('[data-act=gen-league]');
  await page.waitForSelector('#panel-league table.matrix');
}

test.describe('総当たり表のキーボード操作（N12）', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('Tab が止まる対戦表のマスは1つだけ。Tab で入り、もう一度 Tab で出る', async ({ page }) => {
    await makeLeague(page);
    expect(await page.locator('.matrix td.cell[tabindex="0"]').count()).toBe(1);
    expect(await page.locator('.matrix td.cell[tabindex="-1"]').count()).toBe(11); // 4人: 12マス中の11
    await page.locator('.matrix-card [data-export-toggle]').first().focus(); // 対戦表の直前の部品（「出力」）
    await page.keyboard.press('Tab');
    expect(await at(page)).toBe('0,1'); // 最初のマス（自分自身の (0,0) は飛ばす）
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('.matrix'))).toBe(false); // 表の外へ
    await page.keyboard.press('Shift+Tab');
    expect(await at(page)).toBe('0,1'); // 戻ると、同じマス
  });

  test('矢印キーで上下左右へ移る。自分自身のマスは飛ばし、Home／End で行の先頭／最後へ。移ったマスだけが Tab の停止位置', async ({ page }) => {
    await makeLeague(page);
    await page.locator('.matrix td.cell[tabindex="0"]').focus();
    await page.keyboard.press('ArrowDown');
    expect(await at(page)).toBe('2,1'); // (1,1) は自分自身なので、その下へ
    await page.keyboard.press('ArrowRight');
    expect(await at(page)).toBe('2,3'); // (2,2) を飛ばす
    await page.keyboard.press('ArrowRight');
    expect(await at(page)).toBe('2,3'); // 端では動かない
    await page.keyboard.press('Home');
    expect(await at(page)).toBe('2,0');
    await page.keyboard.press('End');
    expect(await at(page)).toBe('2,3');
    await page.keyboard.press('ArrowUp');
    expect(await at(page)).toBe('1,3');
    await page.keyboard.press('ArrowLeft');
    expect(await at(page)).toBe('1,2');
    // Tab の停止位置は、今いるマスだけ
    expect(await page.locator('.matrix td.cell[tabindex="0"]').count()).toBe(1);
    expect(await page.evaluate(() => document.activeElement.getAttribute('tabindex'))).toBe('0');
  });

  test('各マスに読み上げの名前（aria-label）が付く。結果を入れると、勝ち・負けとスコアに変わる', async ({ page }) => {
    await makeLeague(page);
    const cell = page.locator('.matrix td.cell[data-r="0"][data-c="1"]');
    await expect(cell).toHaveAttribute('aria-label', '山田 太郎 対 佐藤 花子、未入力');
    await expect(page.locator('.matrix td.cell[data-r="1"][data-c="0"]')).toHaveAttribute('aria-label', '佐藤 花子 対 山田 太郎、未入力');
    await cell.focus();
    await page.keyboard.press('Enter');
    await enterScore(page, 3, 1);
    await expect(page.locator('.matrix td.cell[data-r="0"][data-c="1"]')).toHaveAttribute('aria-label', /^山田 太郎 対 佐藤 花子、(勝ち 3-1|負け 1-3)$/);
  });

  test('Enter・Space で結果入力が開き、閉じる（キャンセル・Esc・保存）と、開いたマスにフォーカスが戻る', async ({ page }) => {
    await makeLeague(page);
    const dlg = page.locator('#result-dialog');
    await page.locator('.matrix td.cell[tabindex="0"]').focus();
    await page.keyboard.press('ArrowDown'); // (2,1)
    await page.keyboard.press('Enter');
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).not.toBeVisible();
    expect(await at(page)).toBe('2,1');

    await page.keyboard.press(' '); // Space でも開く（ページは動かない）
    await expect(dlg).toBeVisible();
    await page.click('#rd-cancel');
    await expect(dlg).not.toBeVisible();
    expect(await at(page)).toBe('2,1');

    // 保存すると画面が作り直されるが、同じ位置のマスにフォーカスが戻る
    await page.keyboard.press('Enter');
    await enterScore(page, 2, 0);
    await expect(dlg).not.toBeVisible();
    // close イベントは非同期に発火するため、フォーカスが戻るまで待つ（CI の遅い環境で、読むのが早すぎて失敗した）
    await expect(async () => {
      expect(await at(page)).toBe('2,1');
      expect(await page.evaluate(() => document.activeElement.isConnected && document.activeElement.matches('.matrix td.cell'))).toBe(true);
    }).toPass({ timeout: 5000 });
    // そのまま矢印キーで動ける
    await page.keyboard.press('ArrowRight');
    expect(await at(page)).toBe('2,3');
  });

  test('試合結果一覧の表も、上下の矢印キーで行を移り、Enter で結果入力が開く。閉じると同じ行に戻る', async ({ page }) => {
    await makeLeague(page);
    const rows = page.locator('.results-table tbody tr[data-match]');
    await expect(rows).toHaveCount(6);
    expect(await page.locator('.results-table tbody tr[tabindex="0"]').count()).toBe(1);
    await expect(rows.first()).toHaveAttribute('aria-label', /^No\.1 .+ 対 .+、.*試合待ち$/);
    await page.locator('.results-table tbody tr[tabindex="0"]').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const third = await page.evaluate(() => document.activeElement.dataset.match);
    expect(await rows.nth(2).getAttribute('data-match')).toBe(third);
    await page.keyboard.press('ArrowUp');
    expect(await rows.nth(1).getAttribute('data-match')).toBe(await page.evaluate(() => document.activeElement.dataset.match));
    await page.keyboard.press('End');
    expect(await rows.nth(5).getAttribute('data-match')).toBe(await page.evaluate(() => document.activeElement.dataset.match));
    await page.keyboard.press('Home');
    expect(await rows.nth(0).getAttribute('data-match')).toBe(await page.evaluate(() => document.activeElement.dataset.match));
    await page.keyboard.press('ArrowDown');
    const second = await page.evaluate(() => document.activeElement.dataset.match);
    await page.keyboard.press('Enter');
    await expect(page.locator('#result-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.activeElement.dataset.match)).toBe(second);
    expect(await page.locator('.results-table tbody tr[tabindex="0"]').count()).toBe(1);
  });

  test('絞り込みで隠れた行には Tab が止まらない（見えている行に停止位置が移る）', async ({ page }) => {
    await makeLeague(page);
    await page.fill('#mf-name', '高橋');
    const rows = page.locator('.results-table tbody tr[data-match]:visible');
    await expect(rows).toHaveCount(3);
    expect(await page.locator('.results-table tbody tr[tabindex="0"]:visible').count()).toBe(1);
    expect(await page.locator('.results-table tbody tr[tabindex="0"]:not(:visible)').count()).toBe(0);
  });

  test('過去の回（閲覧専用）では、移動だけできて、Enter を押しても結果入力は開かない', async ({ page }) => {
    acceptDialogs(page);
    await makeLeague(page, ['山田 太郎', '佐藤 花子', '鈴木 一郎']);
    for (let i = 0; i < 3; i++) {
      await page.locator('#panel-league .next-item').first().click();
      await enterScore(page, 2, 1);
      await expect(page.locator('#result-dialog')).not.toBeVisible();
    }
    await page.click('.progress [data-edition=next]');
    await page.click('.tabs [data-tab=setup]');
    await page.click('[data-edition-view="1"]');
    await page.click('.tabs [data-tab=league]');
    await expect(page.locator('#edition-banner')).toBeVisible();
    await page.locator('.matrix td.cell[tabindex="0"]').focus();
    await page.keyboard.press('ArrowDown');
    expect(await at(page)).toBe('2,1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#result-dialog')).not.toBeVisible();
    expect(await at(page)).toBe('2,1');
  });
});
