import { test, expect } from '@playwright/test';
import { open, importNames } from './helpers.js';

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
