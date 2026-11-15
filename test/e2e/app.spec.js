import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { NAMES, acceptDialogs, open, importNames, setNumber, enterScore, download, pngSize, genTournament } from './helpers.js';

test.describe('参加者・設定', () => {
  test('追加・編集・並べ替え・削除と入力チェック', async ({ page }) => {
    acceptDialogs(page);
    await open(page);
    await page.fill('#new-player', '山田');
    await page.press('#new-player', 'Enter');
    await page.fill('#new-player', '佐藤');
    await page.click('#add-player-form button');
    await expect(page.locator('#player-count')).toHaveText('2人');
    // 空欄で追加はされない
    await page.click('#add-player-form button');
    await expect(page.locator('#player-count')).toHaveText('2人');
    // 重複（全角・空白違い）を検出し、作成できない
    await page.fill('#new-player', 'ヤマダ');
    await page.press('#new-player', 'Enter');
    await page.locator('input.name').nth(2).fill('山 田');
    await expect(page.locator('#player-errors')).toContainText('重複');
    await page.click('[data-act=gen-tournament]'); // 名簿にエラーがあるので、組み合わせの確認には進まない
    await expect(page.locator('#toast')).toContainText('空欄・重複');
    await expect(page.locator('[data-tab=tournament]')).toHaveAttribute('aria-selected', 'false');
    // 直して並べ替え・削除
    await page.locator('input.name').nth(2).fill('鈴木');
    await expect(page.locator('#player-errors')).toBeHidden();
    await page.locator('[data-act=up][data-i="2"]').click();
    await expect(page.locator('input.name').nth(1)).toHaveValue('鈴木');
    await page.locator('[data-act=del][data-i="0"]').click();
    await expect(page.locator('#player-count')).toHaveText('2人');
    await expect(page.locator('input.name').nth(0)).toHaveValue('鈴木');
  });

  test('1人ではトーナメントを作成できない', async ({ page }) => {
    acceptDialogs(page);
    await open(page);
    await importNames(page, ['山田']);
    await page.click('[data-act=gen-tournament]'); // 人数が足りないので、組み合わせの確認には進まない
    await expect(page.locator('#toast')).toContainText('2人以上');
  });

  test('CSV取込（Shift_JIS・見出しあり）', async ({ page }) => {
    acceptDialogs(page);
    await open(page);
    await page.click('[data-act=import]');
    // 「氏名\r\n山田\r\n佐藤\r\n」の Shift_JIS
    const sjis = Buffer.from([0x8e, 0x81, 0x96, 0xbc, 0x0d, 0x0a, 0x8e, 0x52, 0x93, 0x63, 0x0d, 0x0a, 0x8d, 0xb2, 0x93, 0xa1, 0x0d, 0x0a]);
    await page.setInputFiles('#im-file', { name: 'meibo.csv', mimeType: 'text/csv', buffer: sjis });
    await expect(page.locator('#im-text')).toHaveValue('山田\n佐藤');
    await expect(page.locator('#im-file-name')).toContainText('2人');
    await page.click('#import-form button[type=submit]');
    await expect(page.locator('input.name')).toHaveCount(2);
    await expect(page.locator('input.name').nth(1)).toHaveValue('佐藤');
  });

  test('卓数と卓名の変更が試合に反映される', async ({ page }) => {
    acceptDialogs(page);
    await open(page);
    await importNames(page, NAMES.slice(0, 4));
    await setNumber(page, '#table-count', 1);
    await expect(page.locator('input.table-name')).toHaveCount(1);
    await page.locator('input.table-name').first().fill('Aコート');
    await genTournament(page);
    const rows = page.locator('table.results tbody tr');
    await expect(rows.nth(0)).toContainText('Aコート');
    await expect(rows.nth(1).locator('td').nth(3)).toHaveText('2'); // 時間帯2
  });
});

test.describe('トーナメント', () => {
  test('シード・不戦・勝者の自動反映・結果修正・優勝', async ({ page }) => {
    const dialogs = acceptDialogs(page);
    await open(page);
    await importNames(page, NAMES.slice(0, 6));
    await page.selectOption('#seed-mode', 'pick');
    await page.locator('.seed-pick-box').nth(0).check();
    await page.locator('.seed-pick-box').nth(1).check();
    await expect(page.locator('.seed-badge')).toHaveCount(2);
    await expect(page.locator('#panel-setup')).toContainText('1回戦不戦（シード上位から） 2枠');
    await genTournament(page);
    await expect(page.locator('[data-tab=tournament]')).toHaveAttribute('aria-selected', 'true');

    // 6人 → 実試合5、シード2人は不戦
    await expect(page.locator('#bracket-wrap g.match')).toHaveCount(5);
    const results = page.locator('table.results tbody');
    await expect(results.locator('tr', { hasText: '不戦' })).toHaveCount(2);
    await expect(results.locator('tr', { hasText: '不戦' }).first()).toContainText('山田 太郎');
    await expect(page.locator('.next-item')).toHaveCount(2);

    // No.1: 高橋 vs 田中 → 3-1 で高橋
    await page.locator('.next-item', { hasText: 'No.1' }).click();
    await expect(page.locator('#rd-p1')).toHaveText('高橋 次郎');
    await enterScore(page, 3, 1);
    await expect(page.locator('#toast')).toContainText('保存しました');
    // 準決勝 山田 vs 高橋 が試合待ちに
    const semi = results.locator('tr', { hasText: '準決勝' }).first();
    await expect(semi).toContainText('山田 太郎');
    await expect(semi).toContainText('高橋 次郎');
    await expect(semi).toContainText('試合待ち');

    // スコアと勝者の矛盾はエラーで保存されない
    await page.locator('.next-item', { hasText: 'No.2' }).click();
    await page.fill('#rd-s1', '0');
    await page.fill('#rd-s2', '2');
    await page.check('#result-form input[value=p1]');
    await page.click('#rd-ok');
    await expect(page.locator('#rd-error')).toContainText('一致しません');
    // 同点は勝者を選ばないとエラー
    await page.fill('#rd-s1', '1');
    await page.fill('#rd-s2', '1');
    await page.click('#rd-ok');
    await expect(page.locator('#rd-error')).toContainText('同点');
    // 不戦勝
    await page.fill('#rd-s1', '');
    await page.fill('#rd-s2', '');
    await page.check('#rd-walkover');
    await page.click('#rd-ok');
    await expect(page.locator('#rd-error')).toContainText('勝者を選んで');
    await page.check('#result-form input[value=p2]');
    await page.click('#rd-ok');
    await expect(results.locator('tr').filter({ hasText: '不戦勝' })).toContainText('伊藤 四郎');

    // 準決勝・決勝を進める
    await page.locator('.next-item', { hasText: 'No.3' }).click();
    await enterScore(page, 2, 0); // 山田
    await page.locator('.next-item', { hasText: 'No.4' }).click();
    await enterScore(page, 0, 2); // 伊藤
    await page.locator('.next-item', { hasText: 'No.5' }).click();
    await expect(page.locator('#rd-title')).toContainText('決勝');
    await enterScore(page, 1, 0);
    await expect(page.locator('.champion')).toHaveText('優勝 山田 太郎');
    await expect(page.locator('.progress')).toContainText('5 / 5');

    // 1回戦の結果を修正 → 準決勝・決勝の結果が確認のうえ消える
    dialogs.length = 0;
    await page.locator('table.results tbody tr[data-match="R1-M2"]').click();
    await enterScore(page, 0, 3); // 田中の勝ちに修正
    expect(dialogs.join('\n')).toContain('次の試合の結果が取り消されます');
    expect(dialogs.join('\n')).toContain('準決勝 No.3');
    expect(dialogs.join('\n')).toContain('決勝 No.5');
    await expect(page.locator('.champion')).toHaveCount(0);
    await expect(results.locator('tr', { hasText: '準決勝' }).first()).toContainText('田中 三郎');
    // 残るのは No.1（修正後）・No.2・No.4（反対側の準決勝）
    await expect(page.locator('.progress')).toContainText('3 / 5');

    // 順位表
    await page.click('[data-tab=standings]');
    await expect(page.locator('#panel-standings')).toContainText('高橋 次郎');
  });

  test('確認でキャンセルすると結果は変わらない', async ({ page }) => {
    await open(page);
    page.on('dialog', (d) => d.accept());
    await importNames(page, NAMES.slice(0, 4));
    await genTournament(page);
    await page.locator('.next-item').nth(0).click();
    await enterScore(page, 1, 0);
    await page.locator('.next-item').nth(0).click();
    await enterScore(page, 1, 0);
    await page.locator('.next-item').nth(0).click();
    await enterScore(page, 1, 0);
    await expect(page.locator('.champion')).toHaveText('優勝 山田 太郎');
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => d.dismiss());
    await page.locator('tr[data-match="R1-M1"]').click();
    await enterScore(page, 0, 1);
    await expect(page.locator('#rd-error')).toContainText('中止');
    await page.click('#rd-cancel');
    await expect(page.locator('.champion')).toHaveText('優勝 山田 太郎');
  });

  test('3位決定戦と卓の手動変更、名前変更の反映', async ({ page }) => {
    acceptDialogs(page);
    await open(page);
    await importNames(page, NAMES.slice(0, 4));
    await page.check('#third-place');
    await genTournament(page);
    await expect(page.locator('table.results')).toContainText('3位決定戦');
    // 卓を手動で変更
    await page.locator('tr[data-match="R1-M1"]').click();
    await page.selectOption('#rd-table', { label: '第2卓' });
    await page.click('#rd-ok');
    await expect(page.locator('#toast')).toContainText('卓を変更');
    await expect(page.locator('tr[data-match="R1-M1"] td').nth(2)).toHaveText('第2卓');
    // 名前の変更は表に反映される
    await page.click('[data-tab=setup]');
    await page.locator('input.name').nth(0).fill('山田 太郎（主将）');
    await page.click('[data-tab=tournament]');
    await expect(page.locator('#bracket-wrap')).toContainText('山田 太郎（主将）');
    // 参加者を追加すると作り直しの案内
    await page.click('[data-tab=setup]');
    await page.fill('#new-player', '追加 選手');
    await page.press('#new-player', 'Enter');
    await page.click('[data-tab=tournament]');
    await expect(page.locator('.notice')).toContainText('作り直して');
  });

  test('64人でも生成・表示できる', async ({ page }) => {
    acceptDialogs(page);
    await open(page);
    await importNames(page, Array.from({ length: 64 }, (_, i) => `選手${i + 1}`));
    await page.selectOption('#seed-mode', 'random');
    await setNumber(page, '#seed-count', 8);
    await genTournament(page);
    await expect(page.locator('#bracket-wrap g.match')).toHaveCount(63);
    await expect(page.locator('#panel-tournament .table-board .tc')).toHaveCount(2); // 卓ごとのカード（卓は2つ）
  });
});

test.describe('総当たり', () => {
  test('生成・結果入力・引き分け・不戦勝・順位', async ({ page }) => {
    acceptDialogs(page);
    await open(page);
    await importNames(page, NAMES.slice(0, 5));
    await page.click('[data-act=gen-league]');
    await expect(page.locator('[data-tab=league]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('table.results tbody tr')).toHaveCount(10);
    await expect(page.locator('.progress')).toContainText('休み');

    const cell = (r, c) => page.locator('table.matrix tbody tr').nth(r).locator('td').nth(c);
    // 山田(行0) vs 佐藤(列1) を 3-1
    await cell(0, 1).click();
    const p1 = await page.locator('#rd-p1').textContent();
    if (p1 === '山田 太郎') await enterScore(page, 3, 1); else await enterScore(page, 1, 3);
    await expect(cell(0, 1)).toHaveText('○ 3-1');
    await expect(cell(1, 0)).toHaveText('× 1-3');
    // 山田 vs 鈴木 引き分け
    await cell(0, 2).click();
    await enterScore(page, 2, 2);
    await expect(cell(0, 2)).toHaveText('△ 2-2');
    // 佐藤 vs 鈴木 不戦勝（鈴木の勝ち）
    await cell(1, 2).click();
    await page.check('#rd-walkover');
    const left = await page.locator('#rd-p1').textContent();
    await page.check(`#result-form input[value=${left === '鈴木 一郎' ? 'p1' : 'p2'}]`);
    await page.click('#rd-ok');
    await expect(cell(2, 1)).toHaveText('○ 不戦勝');

    await page.click('[data-tab=standings]');
    const rows = page.locator('#panel-standings table').last().locator('tbody tr');
    await expect(rows.nth(0)).toContainText('山田 太郎'); // 勝点4
    await expect(rows.nth(0).locator('td').last()).toHaveText('4');
    await expect(rows.nth(1)).toContainText('鈴木 一郎'); // 勝点4、得失点差で下
    // 引き分けなしに変更すると同点入力はエラー
    await page.click('[data-tab=setup]');
    await page.uncheck('#allow-draw');
    await page.click('[data-tab=league]');
    await cell(3, 4).click();
    await expect(page.locator('#rd-draw-wrap')).toBeHidden();
    await enterScore(page, 1, 1);
    await expect(page.locator('#rd-error')).toContainText('同点');
  });
});

test.describe('出力', () => {
  // 注: この環境の Chromium は1ページで11回目のダウンロードを取りこぼすため、テストを分けている（TEST_REPORT.md 参照）
  async function prepare(page) {
    acceptDialogs(page);
    await open(page);
    await page.fill('#meta-title', '春季部内大会');
    await importNames(page, NAMES.slice(0, 5));
  }

  test('トーナメント表・試合結果の CSV（BOM付きUTF-8・日本語）と PNG', async ({ page }) => {
    await prepare(page);
    await genTournament(page);
    await page.locator('.next-item').first().click();
    await enterScore(page, 3, 1);

    const csv = await download(page, '[data-export=bracket-csv]');
    expect(csv.name).toBe('春季部内大会_トーナメント表.csv');
    expect([...csv.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = csv.bytes.toString('utf8');
    expect(text).toContain('山田 太郎');
    expect(text).toContain('\r\n');
    const res = await download(page, '[data-export=results-csv]');
    expect(res.name).toBe('春季部内大会_トーナメント_試合結果.csv');
    expect(res.bytes.toString('utf8')).toContain('試合番号,回戦,卓,時間帯,選手1,スコア,選手2,勝者,状態');
    // スコアは、Excel が日付（3月1日）に変えないよう ="3-1" の形で出る
    expect(res.bytes.toString('utf8')).toContain(',"=""3-1""",');

    for (const sel of ['[data-export=bracket-png]', '[data-export=results-png]']) {
      const png = await download(page, sel);
      expect(png.name.endsWith('.png')).toBe(true);
      const size = pngSize(png.bytes);
      expect(size).not.toBeNull();
      expect(size.width).toBeGreaterThan(600);
      expect(size.height).toBeGreaterThan(300);
    }
  });

  test('総当たり表・試合結果の CSV と PNG', async ({ page }) => {
    await prepare(page);
    await page.click('[data-act=gen-league]');
    const mcsv = await download(page, '[data-export=matrix-csv]');
    expect(mcsv.name).toBe('春季部内大会_総当たり表.csv');
    expect(mcsv.bytes.toString('utf8')).toContain(',勝,分,敗,勝点,順位');
    expect(pngSize((await download(page, '[data-export=matrix-png]')).bytes)).not.toBeNull();
    expect(pngSize((await download(page, '#panel-league [data-export=results-png]')).bytes)).not.toBeNull();
    const r = await download(page, '#panel-league [data-export=results-csv]');
    expect(r.bytes.toString('utf8')).toContain('試合番号,回戦,卓,時間帯,選手1,スコア,選手2,結果,状態');
  });

  test('順位表の CSV と PNG', async ({ page }) => {
    await prepare(page);
    await genTournament(page);
    await page.click('[data-tab=setup]');
    await page.click('[data-act=gen-league]');
    await page.click('[data-tab=standings]');
    const t = await download(page, '[data-export=t-csv]');
    expect(t.bytes.toString('utf8')).toContain('順位,名前,成績,勝,敗');
    const l = await download(page, '[data-export=l-csv]');
    expect(l.bytes.toString('utf8')).toContain('得失点差');
    expect(pngSize((await download(page, '[data-export=t-png]')).bytes)).not.toBeNull();
    expect(pngSize((await download(page, '[data-export=l-png]')).bytes)).not.toBeNull();
  });
});

test.describe('保存・読込', () => {
  test('ファイルに保存→新規→読込で復元', async ({ page }) => {
    acceptDialogs(page);
    await open(page);
    await page.fill('#meta-title', '秋季大会');
    await importNames(page, NAMES.slice(0, 4));
    await genTournament(page);
    await page.locator('.next-item').first().click();
    await enterScore(page, 5, 4);
    const saved = await download(page, '[data-action=save]');
    expect(saved.name).toMatch(/^秋季大会_\d{4}-\d{2}-\d{2}\.json$/);

    await page.click('[data-action=new]');
    await expect(page.locator('#player-count')).toHaveText('0人');
    await page.setInputFiles('#load-file', { name: 'x.json', mimeType: 'application/json', buffer: saved.bytes });
    await expect(page.locator('#toast')).toContainText('秋季大会');
    await page.click('[data-tab=tournament]');
    await expect(page.locator('table.results')).toContainText('5-4');
  });

  test('不正なファイルは読み込まない', async ({ page }) => {
    acceptDialogs(page);
    await open(page);
    await importNames(page, ['山田', '佐藤']);
    await page.setInputFiles('#load-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"foo":1}') });
    await expect(page.locator('#toast')).toContainText('読み込めませんでした');
    await expect(page.locator('#player-count')).toHaveText('2人');
  });

  test('ID に HTML を仕込んだファイルは読み込まず、スクリプトも動かない', async ({ page }) => {
    acceptDialogs(page);
    await open(page);
    const evil = 'L1"><img id=pwn src=x onerror="document.title=\'XSS\'">';
    const data = {
      kind: 'bukatsu-taikai', version: 1, meta: { title: '細工' }, settings: {}, tournament: null,
      players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], tables: [{ id: 't1', name: '第1卓' }],
      league: { playerIds: ['a', 'b'], matches: [{ id: evil, round: 1, p1: 'a', p2: 'b' }], results: {} },
    };
    await page.setInputFiles('#load-file', { name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await expect(page.locator('#toast')).toContainText('読み込めませんでした');
    await page.click('[data-tab=league]');
    await expect(page.locator('#pwn')).toHaveCount(0);
    expect(await page.title()).not.toBe('XSS');
  });

  test('自動保存: 再読み込みしても続きから', async ({ page }) => {
    acceptDialogs(page);
    await open(page);
    await importNames(page, NAMES.slice(0, 3));
    await page.click('[data-act=gen-league]');
    await page.locator('.next-item').first().click();
    await enterScore(page, 1, 0);
    await page.reload();
    await expect(page.locator('#toast')).toContainText('前回の続き');
    await expect(page.locator('[data-tab=league]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('table.results')).toContainText('1-0');
  });
});

test('file:// で index.html を直接開いても動く', async ({ page }) => {
  acceptDialogs(page);
  const url = new URL('../../web/index.html', import.meta.url).href;
  expect(fileURLToPath(url)).toContain('web');
  await page.goto(url);
  await importNames(page, ['山田', '佐藤', '鈴木']);
  await genTournament(page);
  await expect(page.locator('#bracket-wrap svg')).toBeVisible();
  await page.locator('.next-item').first().click();
  await enterScore(page, 2, 1);
  await expect(page.locator('.progress')).toContainText('1 / 2');
});

test('印刷用レイアウト: 操作ボタンが隠れる', async ({ page }) => {
  acceptDialogs(page);
  await open(page);
  await importNames(page, NAMES.slice(0, 4));
  await genTournament(page);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.tabs')).toBeHidden();
  await expect(page.locator('.toolbar').first()).toBeHidden();
  await expect(page.locator('#print-title')).toBeVisible();
  await expect(page.locator('#bracket-wrap svg')).toBeVisible();
});
