import { test, expect } from '@playwright/test';
import { open, importNames, acceptDialogs, genTournament, enterScore } from './helpers.js';

// 同じブラウザで、アプリを2つのタブ（ウィンドウ）で開いたとき。
// 以前は、古い内容のままのタブで操作すると、もう片方のタブの変更を上書きして消していた
test('別のタブでの変更が、開いたままのタブに反映され、どちらで操作しても互いの変更が消えない', async ({ context }) => {
  const a = await context.newPage();
  await open(a);
  const b = await context.newPage();
  await b.goto('/');
  await expect(b.locator('#player-count')).toHaveText('0人');

  // タブAで名簿を入れる → タブBにも出る（再読み込みなし）
  await importNames(a, ['山田 太郎', '佐藤 花子']);
  await expect(b.locator('#player-count')).toHaveText('2人');
  await expect(b.locator('input.name').first()).toHaveValue('山田 太郎');

  // タブBで1人足す → タブAの2人は消えず、3人になる。タブAにも出る
  await b.fill('#new-player', '鈴木 一郎');
  await b.press('#new-player', 'Enter');
  await expect(b.locator('#player-count')).toHaveText('3人');
  await expect(a.locator('#player-count')).toHaveText('3人');

  // タブAで名前を直す → タブBにも出る。保存されている内容も3人のまま
  await a.locator('input.name').first().fill('山田 次郎');
  await a.locator('input.name').first().press('Tab');
  await expect(b.locator('input.name').first()).toHaveValue('山田 次郎');
  await a.reload();
  await expect(a.locator('#player-count')).toHaveText('3人');
  await expect(a.locator('input.name').first()).toHaveValue('山田 次郎');

  // 別のタブの変更を取り込んだあとは、「元に戻す」で相手の変更を消せない
  await expect(b.locator('[data-action=undo]')).toBeDisabled();
});

// 結果入力を開いたままのタブが、別のタブの結果を取り込んだあとに保存すると、
// 開いた時点の古い表を書き戻して、別のタブの結果を消していた（レビューの指摘 R-01）
test('入力を開いたままのタブは、別のタブの変更を取り込むと入力を閉じ、別のタブの結果を消さない', async ({ context }) => {
  const a = await context.newPage();
  acceptDialogs(a);
  await open(a);
  await importNames(a, ['山田 太郎', '佐藤 花子', '鈴木 一郎', '高橋 次郎']);
  await genTournament(a);
  await a.waitForSelector('#bracket-wrap svg');
  const b = await context.newPage();
  acceptDialogs(b);
  await b.goto('/');
  await b.click('.tabs [data-tab=tournament]');
  await expect(b.locator('.next-item')).toHaveCount(2);

  // タブBで、2つ目の試合の結果入力を開いたままにする
  await b.locator('.next-item').nth(1).click();
  await expect(b.locator('#result-dialog')).toBeVisible();
  await b.fill('#rd-s1', '3');

  // タブAで、1つ目の試合の結果を保存する → タブBの入力は閉じ、知らせが出る
  await a.locator('.next-item').first().click();
  await enterScore(a, 2, 1);
  await expect(b.locator('#result-dialog')).not.toBeVisible();
  await expect(b.locator('#toast')).toContainText('別のタブで大会データが変わったため');

  // タブBで開き直して保存しても、タブAの結果は残る（2試合とも終わる）
  await b.locator('.next-item').first().click();
  await enterScore(b, 3, 0);
  await expect(b.locator('#result-dialog')).not.toBeVisible();
  await a.reload();
  await a.click('.tabs [data-tab=tournament]');
  await expect(a.locator('.results tbody tr.st-done')).toHaveCount(2);
});
