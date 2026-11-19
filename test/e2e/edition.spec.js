import { test, expect } from '@playwright/test';
import { open, importNames, acceptDialogs, enterScore, download, genTournament } from './helpers.js';

const FOUR = ['山田 太郎', '佐藤 花子', '鈴木 一郎', '高橋 次郎'];

/** 4人のトーナメントを作り、最後まで入力する（毎回、表の上側の選手が勝つ） */
async function playTournament(page) {
  await genTournament(page);
  await page.waitForSelector('#bracket-wrap svg');
  for (let i = 0; i < 3; i++) {
    await page.locator('.next-item').first().click();
    await enterScore(page, 2, 1);
    await expect(page.locator('#result-dialog')).not.toBeVisible();
  }
}

test('同じメンバーで次の回を始め、過去の回を見て、保存・読込・削除できる', async ({ page }) => {
  const dialogs = acceptDialogs(page);
  await open(page);
  await importNames(page, FOUR);
  await page.fill('#meta-title', '春の大会');
  await page.fill('#meta-date', '2099-04-01');
  await page.fill('#meta-time', '13:30');
  await page.press('#meta-time', 'Tab');

  // 表が無いうちは始められない
  await expect(page.locator('#editions-card')).toContainText('今は第1回大会');
  await expect(page.locator('#editions-card [data-edition=next]')).toBeDisabled();

  await playTournament(page);
  await page.click('.tabs [data-tab=tournament]');
  await expect(page.locator('.champion')).toContainText('優勝');
  const champ = (await page.locator('.champion').textContent()).replace('優勝', '').trim();

  // 終わったら、その場から次の回を始められる。確認の文言に引き継ぐ内容が出る
  await page.click('.progress [data-edition=next]');
  expect(dialogs.some((m) => m.includes('第1回大会の表と結果を「過去の大会」に残して、第2回大会を始めます'))).toBe(true);

  // 参加者・卓・設定はそのまま、表と結果は新しくなる。開催日は入れ直し
  await expect(page.locator('#panel-setup')).toBeVisible();
  await expect(page.locator('#editions-card')).toContainText('今は第2回大会');
  await expect(page.locator('#player-count')).toHaveText('4人');
  await expect(page.locator('input.name').first()).toHaveValue('山田 太郎');
  await expect(page.locator('#meta-date')).toHaveValue('');
  await page.click('.tabs [data-tab=tournament]');
  await expect(page.locator('#panel-tournament')).toContainText('まだ作成されていません');

  // 過去の回の一覧: 優勝者が出る
  await page.click('.tabs [data-tab=setup]');
  await expect(page.locator('table.editions tbody tr')).toHaveCount(1);
  await expect(page.locator('table.editions')).toContainText('第1回大会');
  await expect(page.locator('table.editions')).toContainText('2099/04/01 13:30');
  await expect(page.locator('table.editions')).toContainText(`トーナメント 優勝 ${champ}`);

  // 過去の回を見る: 閲覧専用で、結果が見え、出力のファイル名に回が入る
  await page.click('[data-edition-view="1"]');
  await expect(page.locator('#edition-banner')).toBeVisible();
  await expect(page.locator('#edition-banner')).toContainText('第1回大会の記録を見ています');
  await expect(page.locator('#bracket-wrap svg')).toBeVisible();
  await expect(page.locator('.results tbody tr.st-done')).toHaveCount(3);
  await expect(page.locator('[data-tab=setup]')).toBeHidden();
  await expect(page.locator('[data-action=save]')).toBeHidden();
  await expect(page.getByRole('button', { name: '共有', exact: true })).toBeHidden();
  await page.locator('g.match').first().click();
  await expect(page.locator('#result-dialog')).not.toBeVisible(); // 結果は変更できない
  const csv = await download(page, '[data-export=results-csv]');
  expect(csv.name).toContain('春の大会_第1回');
  // 見ている間に、現在の回のデータは書き換わらない
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bukatsu-taikai:state')));
  expect(saved.tournament).toBeNull();
  expect(saved.history).toHaveLength(1);

  // 現在の回へ戻る
  await page.selectOption('#eb-select', 'current');
  await expect(page.locator('#edition-banner')).toBeHidden();
  await expect(page.locator('[data-tab=setup]')).toBeVisible();
  await expect(page.locator('#editions-card')).toContainText('今は第2回大会');

  // 第2回を進めると、出力のファイル名は「第2回」になる
  await playTournament(page);
  await page.click('.tabs [data-tab=tournament]');
  const csv2 = await download(page, '[data-export=results-csv]');
  expect(csv2.name).toContain('春の大会_第2回');
  await page.click('.tabs [data-tab=setup]');

  // 再読み込みしても、過去の回が残る
  await page.reload();
  await page.click('.tabs [data-tab=setup]');
  await expect(page.locator('table.editions tbody tr')).toHaveCount(1);

  // 保存（JSON）に過去の回が入り、新規にしてから読み込むと戻る
  const file = await download(page, '[data-action=save]');
  const json = JSON.parse(file.bytes.toString('utf8'));
  expect(json.history).toHaveLength(1);
  await page.click('[data-action=new]');
  await expect(page.locator('table.editions')).toHaveCount(0);
  await page.setInputFiles('#load-file', { name: 'x.json', mimeType: 'application/json', buffer: file.bytes });
  await page.click('.tabs [data-tab=setup]');
  await expect(page.locator('table.editions tbody tr')).toHaveCount(1);
  await expect(page.locator('#editions-card')).toContainText('今は第2回大会');

  // 過去の回の削除。回が無くなれば、大会名に「第N回」は付かない
  await page.click('[data-edition-del="1"]');
  await expect(page.locator('table.editions')).toHaveCount(0);
  await expect(page.locator('#editions-card')).toContainText('今は第1回大会');
  await expect(page.locator('#print-title')).toHaveText('春の大会');
});

test('総当たりが終わったときも次の回を始められる。途中で始めるときは確認に残りの試合が出る', async ({ page }) => {
  const dialogs = acceptDialogs(page);
  await open(page);
  await importNames(page, ['A さん', 'B さん', 'C さん']);
  await page.click('[data-act=gen-league]');
  await page.click('.tabs [data-tab=league]');
  await page.locator('.next-item').first().click();
  await enterScore(page, 3, 0);

  // 途中でも始められるが、確認に残りの試合数が出る
  await page.click('.tabs [data-tab=setup]');
  await page.click('#editions-card > summary'); // 過去の大会がないときは折りたたまれている
  await page.click('#editions-card [data-edition=next]');
  expect(dialogs.some((m) => m.includes('総当たりにあと2試合'))).toBe(true);
  await expect(page.locator('#editions-card')).toContainText('今は第2回大会');
  await expect(page.locator('table.editions')).toContainText('総当たり 途中（1/3試合）');

  // 第2回を最後まで進めると、その場に「第3回を始める」が出る
  await page.click('[data-act=gen-league]');
  await page.click('.tabs [data-tab=league]');
  for (let i = 0; i < 3; i++) {
    await page.locator('.next-item').first().click();
    await enterScore(page, 1, 0);
  }
  await expect(page.locator('.progress [data-edition=next]')).toContainText('第3回大会を始める');
});

test('画面の見出し（印刷・タブ名）に回が付き、過去の回から戻ると現在の回に戻る', async ({ page }) => {
  acceptDialogs(page);
  await open(page);
  await importNames(page, FOUR);
  await playTournament(page);
  await page.click('.tabs [data-tab=setup]');
  await page.click('#editions-card > summary'); // 過去の大会がないときは折りたたまれている
  await page.click('#editions-card [data-edition=next]');
  await page.click('[data-edition-view="1"]');
  await expect(page.locator('#print-title')).toHaveText('部内大会 第1回');
  await expect(page.title()).resolves.toContain('部内大会 第1回');
  await page.click('#edition-banner [data-edition=back]');
  await expect(page.locator('#print-title')).toHaveText('部内大会 第2回');
});

test('名簿を空にしたあとでも、過去の大会が残っていれば「新規」「読込」で確認が出る', async ({ page }) => {
  const messages = [];
  let accept = true;
  page.on('dialog', async (d) => {
    messages.push(d.message());
    if (accept) await d.accept(); else await d.dismiss();
  });
  await open(page);
  await importNames(page, FOUR);
  await playTournament(page);
  await page.click('.tabs [data-tab=tournament]');
  await page.click('.progress [data-edition=next]');
  await expect(page.locator('#editions-card')).toContainText('今は第2回大会');
  const file = await download(page, '[data-action=save]');

  // 名簿を空にする（表も無い）。残っているのは過去の大会だけ
  await page.click('[data-act=clear-players]');
  await expect(page.locator('#player-count')).toHaveText('0人');
  await expect(page.locator('table.editions tbody tr')).toHaveCount(1);

  // 新規: 確認が出て、過去の大会も消えると書いてある。キャンセルすると残る
  accept = false;
  await page.click('[data-action=new]');
  expect(messages.at(-1)).toContain('今の大会データを消して新しく始めますか？');
  expect(messages.at(-1)).toContain('過去の大会（1回分）も消えます');
  await expect(page.locator('table.editions tbody tr')).toHaveCount(1);

  // 読込: 確認が出て、キャンセルすると残る
  await page.setInputFiles('#load-file', { name: 'x.json', mimeType: 'application/json', buffer: file.bytes });
  await expect.poll(() => messages.at(-1)).toContain('読み込んだデータで置き換えますか？');
  expect(messages.at(-1)).toContain('過去の大会（1回分）も読み込んだ内容に置き換わります');
  await expect(page.locator('#player-count')).toHaveText('0人');

  // OK すると読み込まれ、通知の大会名には「第N回」が付く
  accept = true;
  await page.setInputFiles('#load-file', { name: 'x.json', mimeType: 'application/json', buffer: file.bytes });
  await expect(page.locator('#player-count')).toHaveText('4人');
  await expect(page.locator('#toast')).toContainText('第2回');
});
