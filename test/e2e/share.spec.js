import { test, expect } from '@playwright/test';
import { NAMES, open, importNames, acceptDialogs, enterScore, genTournament, download, pngSize } from './helpers.js';
import { encodeQr } from '../../src/core/qr.js';
import { qrSvg } from '../../src/render/qr.js';

// 共有機能: 画面と共有 API（Worker のコード）を同じオリジンで動かして確認する。本番の Cloudflare/D1 ではない
test.use({ baseURL: 'http://localhost:4174/' });
test.describe.configure({ mode: 'serial' });

const ADMIN_PW = 'admin-pass-1';

/** 部屋ごとに別の IP として扱わせ、作成回数の制限に当たらないようにする */
async function withIp(context, ip) {
  await context.setExtraHTTPHeaders({ 'x-test-ip': ip });
}

/** 条件が満たされるまで、画面を前面に戻した扱い（即時の更新確認）を繰り返し発火する。15秒の定期更新を待たないため */
async function untilSynced(page, check, timeout = 15000) {
  await expect(async () => {
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await check();
  }).toPass({ timeout, intervals: [300, 500, 1000] });
}

async function startShare(page) {
  await page.click('[data-action=share]');
  await page.fill('#sh-apw', ADMIN_PW);
  await page.fill('#sh-apwc', ADMIN_PW);
  await page.click('[data-sh=start]');
  await expect(page.locator('.sh-code')).toHaveText(/^[a-hj-km-np-z2-9]{8}$/);
  return (await page.locator('.sh-code').textContent()).trim();
}

async function makeTournament(page) {
  await importNames(page, NAMES);
  await genTournament(page);
  await page.waitForSelector('#bracket-wrap svg');
}

test('運営が共有を始め、閲覧者はリンクを開くだけで見られ、結果の更新とコメントが反映される', async ({ browser }) => {
  const admin = await browser.newContext();
  const viewer = await browser.newContext();
  await withIp(admin, '10.0.0.1');
  await withIp(viewer, '10.0.0.2');
  const a = await admin.newPage();
  const v = await viewer.newPage();
  acceptDialogs(a);
  acceptDialogs(v);

  await open(a);
  await makeTournament(a);
  const code = await startShare(a);
  const link = await a.inputValue('#sh-link');
  expect(link).toBe(`http://localhost:4174/#v=${code}`);
  await a.click('#sh-close');
  await expect(a.locator('#share-chip')).toContainText(code);

  // 閲覧者: リンクを開くだけ（パスワード入力もダイアログも無し）で表が見える
  await v.goto(link);
  await expect(v.locator('#bracket-wrap svg')).toBeVisible();
  await expect(v.locator('#share-dialog')).not.toBeVisible();
  await expect(v.locator('#share-chip')).toContainText('閲覧中');

  // 閲覧専用: 設定タブや編集ボタンが無い。試合をクリックしても入力ダイアログは開かない
  await expect(v.locator('[data-tab=setup]')).toBeHidden();
  await expect(v.locator('[data-action=save]')).toBeHidden();
  await v.locator('g.match').first().click();
  await expect(v.locator('#result-dialog')).not.toBeVisible();
  // 閲覧者の端末の自動保存は、閲覧データで上書きされない
  expect(await v.evaluate(() => localStorage.getItem('bukatsu-taikai:state'))).toBeNull();

  // 運営が結果を入力すると、閲覧者に反映される
  await a.click('.tabs [data-tab=tournament]');
  await a.locator('g.match').first().click();
  await enterScore(a, 3, 1);
  await untilSynced(v, () => expect(v.locator('.results tbody tr.st-done')).toHaveCount(1, { timeout: 1000 }));
  await expect(v.locator('.results tbody tr.st-done')).toContainText('3-1');

  // 閲覧者のコメント
  await v.click('#tab-comments');
  await v.fill('#cf-name', '見学者');
  await v.fill('#cf-text', '<b>がんばれ</b>\n応援しています');
  await v.click('#comment-form button[type=submit]');
  await expect(v.locator('.comment').first()).toContainText('見学者');
  await expect(v.locator('.comment').first()).toContainText('<b>がんばれ</b>'); // タグとして解釈されない
  expect(await v.locator('.comment b').count()).toBe(1); // 名前の <b> だけ（本文の <b> は文字）
  await expect(v.locator('[data-del]')).toHaveCount(0); // 閲覧者は削除できない

  // 運営側にも出て、削除できる
  await a.click('#tab-comments');
  await untilSynced(a, () => expect(a.locator('.comment').first()).toContainText('応援しています', { timeout: 1000 }));
  await a.locator('[data-del]').first().click();
  await expect(a.locator('.comment')).toHaveCount(0);
  await a.locator('.comment-list .empty').waitFor();

  // 閲覧をやめると、この端末の元のデータ（空）に戻る
  await v.click('#share-chip');
  await v.click('[data-sh=disconnect]');
  await v.click('#sh-close');
  await expect(v.locator('[data-tab=setup]')).toBeVisible();
  await expect(v.locator('#share-chip')).toBeHidden();

  await admin.close();
  await viewer.close();
});

test('欠席の印は、閲覧者の画面（表・結果一覧・順位表）にも出る', async ({ browser }) => {
  const admin = await browser.newContext();
  const viewer = await browser.newContext();
  await withIp(admin, '10.0.4.1');
  await withIp(viewer, '10.0.4.2');
  const a = await admin.newPage();
  const v = await viewer.newPage();
  acceptDialogs(a);
  acceptDialogs(v);
  await open(a);
  await importNames(a, ['山田 太郎', '佐藤 花子', '鈴木 一郎', '高橋 次郎']);
  await a.locator('#panel-setup input.attend-box').nth(2).uncheck(); // 鈴木 一郎が欠席
  await a.click('[data-act=gen-tournament]');
  await a.locator('#choice-dialog input[value=walkover]').check();
  await a.locator('#choice-dialog #ch-ok').click();
  await a.click('#pr-ok');
  await a.waitForSelector('#bracket-wrap svg');
  const code = await startShare(a);
  await a.click('#sh-close');

  await v.goto(`http://localhost:4174/#v=${code}`);
  await expect(v.locator('#bracket-wrap svg')).toBeVisible();
  await expect(v.locator('#bracket-wrap svg text', { hasText: '鈴木 一郎（欠席）' }).first()).toBeVisible();
  await expect(v.locator('#panel-tournament table.results td .badge-absent').first()).toHaveText('欠席');
  await v.click('.tabs [data-tab=standings]');
  await expect(v.locator('#panel-standings .badge-absent')).toHaveCount(1);
  await admin.close();
  await viewer.close();
});

test('運営用パスワードを変えても閲覧は続く。共有を終了すると閲覧者は切断される', async ({ browser }) => {
  const admin = await browser.newContext();
  const viewer = await browser.newContext();
  await withIp(admin, '10.0.1.1');
  await withIp(viewer, '10.0.1.2');
  const a = await admin.newPage();
  const v = await viewer.newPage();
  acceptDialogs(a);
  acceptDialogs(v);
  await open(a);
  await makeTournament(a);
  const code = await startShare(a);

  // 閲覧者: 共有コードだけで入る（パスワード欄は無い）
  await v.goto('/');
  await v.click('[data-action=share]');
  await expect(v.locator('section.sh-section', { hasText: '共有を見る' }).locator('input[type=password]')).toHaveCount(0); // 閲覧にパスワード欄は無い
  await v.fill('#sh-code', code);
  await v.click('[data-sh=join]');
  await expect(v.locator('#bracket-wrap svg')).toBeVisible();
  await v.click('#sh-close');

  // 運営用パスワードを変更 → 運営はそのまま使え、閲覧者も影響を受けない
  await a.locator('.sh-details summary').first().click();
  await expect(a.locator('#sh-newa')).toHaveAttribute('type', 'text');
  await a.fill('#sh-newa', 'new-admin-pass');
  await a.click('[data-sh=pw-admin]');
  await expect(a.locator('#toast')).toContainText('変更しました');
  await a.click('[data-sh=push]');
  await expect(a.locator('#share-chip')).not.toContainText('再ログイン');
  await untilSynced(v, () => expect(v.locator('#share-chip')).toContainText('閲覧中', { timeout: 1000 }));
  await expect(v.locator('#share-dialog')).not.toBeVisible();

  // 古い運営用パスワードでは、運営として再接続できない
  await a.click('[data-sh=disconnect]');
  await a.locator('.sh-details summary').first().click();
  await a.fill('#sh-code2', code);
  await a.fill('#sh-apw2', ADMIN_PW);
  await a.click('[data-sh=admin]');
  await expect(a.locator('#sh-error')).toContainText('違います');
  await a.fill('#sh-apw2', 'new-admin-pass');
  await a.click('[data-sh=admin]');
  await expect(a.locator('.sh-code')).toHaveText(code);

  // 共有を終了
  await a.click('[data-sh=close]');
  await expect(a.locator('#share-chip')).toBeHidden();
  await untilSynced(v, () => expect(v.locator('#share-chip')).toBeHidden({ timeout: 1000 }));
  await expect(v.locator('[data-tab=setup]')).toBeVisible();

  await admin.close();
  await viewer.close();
});

test('自分の大会データがある端末で閲覧リンクを開くと、確認してから入り、やめると元のデータに戻る', async ({ browser }) => {
  const admin = await browser.newContext();
  const other = await browser.newContext();
  await withIp(admin, '10.0.2.1');
  await withIp(other, '10.0.2.2');
  const a = await admin.newPage();
  const o = await other.newPage();
  const dialogs = acceptDialogs(o);
  acceptDialogs(a);
  await open(a);
  await makeTournament(a);
  const code = await startShare(a);
  const link = await a.inputValue('#sh-link');

  await open(o);
  await importNames(o, ['自分 一郎', '自分 二郎']);
  await o.goto(link);
  // 自動では入らず、共有コードが入力済みのダイアログが出る
  await expect(o.locator('#share-dialog')).toBeVisible();
  await expect(o.locator('#sh-code')).toHaveValue(code);
  await expect(o.locator('#share-chip')).toBeHidden();
  await o.click('[data-sh=join]');
  await expect(o.locator('#bracket-wrap svg')).toBeVisible();
  expect(dialogs.some((m) => m.includes('この端末の大会データは表示されません'))).toBe(true);
  await o.click('#sh-close');

  await o.click('#share-chip');
  await o.click('[data-sh=disconnect]');
  await o.click('#sh-close');
  await o.click('.tabs [data-tab=setup]');
  await expect(o.locator('#panel-setup')).toContainText('参加者 2人');
  const names = await o.evaluate(() => JSON.parse(localStorage.getItem('bukatsu-taikai:state')).players.map((p) => p.name));
  expect(names).toEqual(['自分 一郎', '自分 二郎']); // 閲覧中も、この端末の保存データは書き換わらない

  await admin.close();
  await other.close();
});

test('共有サーバーに接続できないときは、分かる文言を出して入力内容を保つ', async ({ page }) => {
  await open(page);
  await page.click('[data-action=share]');
  // パスワードを「設定する」欄は普通のテキスト入力（自動入力・自動生成を誘わない）。すでにあるパスワードを「入力する」欄は隠す
  for (const id of ['#sh-apw', '#sh-apwc']) {
    await expect(page.locator(id)).toHaveAttribute('type', 'text');
    await expect(page.locator(id)).toHaveAttribute('autocomplete', 'off');
  }
  await expect(page.locator('#sh-apw2')).toHaveAttribute('type', 'password');
  await page.fill('#sh-base', 'http://localhost:1');
  await page.fill('#sh-apw', ADMIN_PW);
  await page.fill('#sh-apwc', ADMIN_PW);
  await page.click('[data-sh=start]');
  await expect(page.locator('#sh-error')).toContainText('接続できませんでした');
  await expect(page.locator('#sh-apw')).toHaveValue(ADMIN_PW);
  await page.fill('#sh-apwc', 'different');
  await page.click('[data-sh=start]');
  await expect(page.locator('#sh-error')).toContainText('一致しません');
  await page.fill('#sh-apw', 'abc');
  await page.fill('#sh-apwc', 'abc');
  await page.click('[data-sh=start]');
  await expect(page.locator('#sh-error')).toContainText('8文字以上');
});

test('共有中に次の回を始めると、閲覧者の画面も新しい回（表なし）に変わる。「次の回を始める」は閲覧者に出ない', async ({ browser }) => {
  const admin = await browser.newContext();
  const viewer = await browser.newContext();
  await withIp(admin, '10.0.3.1');
  await withIp(viewer, '10.0.3.2');
  const a = await admin.newPage();
  const v = await viewer.newPage();
  const dialogs = acceptDialogs(a);
  acceptDialogs(v);
  await open(a);
  await makeTournament(a);
  const code = await startShare(a);
  const link = await a.inputValue('#sh-link');
  await a.click('#sh-close');

  await v.goto(link);
  await expect(v.locator('#bracket-wrap svg')).toBeVisible();
  await expect(v.locator('#print-title')).toHaveText('部内大会');

  // 運営が次の回を始める（確認に「閲覧者の画面も変わる」と出る）
  await a.click('.tabs [data-tab=setup]');
  await a.click('#editions-card > summary'); // 過去の大会がないときは折りたたまれている
  await a.click('#editions-card [data-edition=next]');
  expect(dialogs.some((m) => m.includes('閲覧者の画面も新しい大会（第2回大会）の内容に変わります'))).toBe(true);
  await untilSynced(v, () => expect(v.locator('#print-title')).toHaveText('部内大会 第2回', { timeout: 1000 }));
  await expect(v.locator('#panel-tournament')).toContainText('まだ作成されていません');
  // 閲覧者には「次の回を始める」・過去の回の一覧（運営用のカード）は出ない
  await expect(v.locator('[data-edition=next]')).toBeHidden();
  await expect(v.locator('#editions-card')).toBeHidden();

  // 運営が過去の回を見ている間は共有に関する操作は隠れ、戻れば共有中の表示が戻る
  await a.click('[data-edition-view="1"]');
  await expect(a.locator('#share-chip')).toBeHidden();
  await a.click('#edition-banner [data-edition=back]');
  await expect(a.locator('#share-chip')).toContainText(code);
  await a.close();
  await v.close();
  await admin.close();
  await viewer.close();
});

test('閲覧者も過去の回の結果を見られる。見ている間に運営が進めても画面は変わらず、戻ると最新が出る', async ({ browser }) => {
  const admin = await browser.newContext();
  const viewer = await browser.newContext();
  await withIp(admin, '10.0.4.1');
  await withIp(viewer, '10.0.4.2');
  const a = await admin.newPage();
  const v = await viewer.newPage();
  acceptDialogs(a);
  acceptDialogs(v);
  await open(a);
  await importNames(a, ['山田 太郎', '佐藤 花子', '鈴木 一郎', '高橋 次郎']);
  await genTournament(a);
  for (let i = 0; i < 3; i++) {
    await a.locator('.next-item').first().click();
    await enterScore(a, 2, 1);
  }
  await startShare(a);
  const link = await a.inputValue('#sh-link');
  await a.click('#sh-close');
  // 第2回を始めて、表を作る（まだ結果は無い）
  await a.click('.progress [data-edition=next]');
  await genTournament(a);
  await a.waitForSelector('#bracket-wrap svg');

  // 閲覧者: 現在の回（第2回）が開き、「過去の回の結果も見られます」が出る
  await v.goto(link);
  await untilSynced(v, () => expect(v.locator('#print-title')).toHaveText('部内大会 第2回', { timeout: 1000 })); // 運営の送信を待つ
  await expect(v.locator('.results tbody tr.st-done')).toHaveCount(0);
  await expect(v.locator('#edition-banner')).toContainText('過去の大会の結果も見られます');
  await expect(v.locator('#eb-select-past option')).toHaveText(['選んでください', '第1回大会']);

  // 第1回を選ぶと、結果が見える。閲覧専用で、コメントタブや共有は隠れる
  await v.selectOption('#eb-select-past', '1');
  await expect(v.locator('#edition-banner')).toContainText('第1回大会の記録を見ています');
  await expect(v.locator('#print-title')).toHaveText('部内大会 第1回');
  await expect(v.locator('.results tbody tr.st-done')).toHaveCount(3);
  await expect(v.locator('#tab-comments')).toBeHidden();
  await expect(v.locator('[data-tab=setup]')).toBeHidden();
  await v.locator('g.match').first().click();
  await expect(v.locator('#result-dialog')).not.toBeVisible();

  // 見ている間に運営が第2回の結果を入れても、第1回の画面は変わらない
  await a.locator('.next-item').first().click();
  await enterScore(a, 3, 0);
  await a.waitForTimeout(2500); // 運営の送信（1.5秒の待ち）を待つ
  await v.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await v.waitForTimeout(800);
  await expect(v.locator('#print-title')).toHaveText('部内大会 第1回');
  await expect(v.locator('.results tbody tr.st-done')).toHaveCount(3);

  // 現在の回に戻ると、最新（第2回の結果が1試合）が出る。閲覧専用のまま
  await v.click('#edition-banner [data-edition=back]');
  await expect(v.locator('#print-title')).toHaveText('部内大会 第2回');
  await expect(v.locator('.results tbody tr.st-done')).toHaveCount(1);
  await expect(v.locator('#share-chip')).toContainText('閲覧中');
  await expect(v.locator('[data-tab=setup]')).toBeHidden();

  // 見ている回を運営が削除すると、閲覧者の画面は現在の回に戻り、選択肢も消える
  await v.selectOption('#eb-select-past', '1');
  await expect(v.locator('#edition-banner')).toContainText('第1回大会の記録を見ています');
  await a.click('.tabs [data-tab=setup]');
  await a.click('[data-edition-del="1"]');
  await untilSynced(v, () => expect(v.locator('#edition-banner')).toBeHidden({ timeout: 1000 }));
  await expect(v.locator('#print-title')).toHaveText('部内大会');
  await expect(v.locator('.results tbody tr.st-done')).toHaveCount(1);

  await admin.close();
  await viewer.close();
});

test('閲覧者の呼び出し画面は、開いたまま運営の結果入力に合わせて更新される', async ({ browser }) => {
  const admin = await browser.newContext();
  const viewer = await browser.newContext();
  await withIp(admin, '10.0.4.1');
  await withIp(viewer, '10.0.4.2');
  const a = await admin.newPage();
  const v = await viewer.newPage();
  acceptDialogs(a);
  acceptDialogs(v);
  await open(a);
  await makeTournament(a);
  await startShare(a);
  const link = await a.inputValue('#sh-link');
  await a.click('#sh-close');

  await v.goto(link);
  await expect(v.locator('#bracket-wrap svg')).toBeVisible();
  await v.click('[data-call=tournament]');
  await expect(v.locator('#cs-progress')).toContainText('0 /');

  // 運営が1試合入力すると、閲覧者の呼び出し画面（開いたまま）の進行が進む
  await a.locator('.next-item').first().click();
  await enterScore(a, 2, 1);
  await untilSynced(v, () => expect(v.locator('#cs-progress')).toContainText('1 /', { timeout: 1000 }));
  await expect(v.locator('#call-screen')).toBeVisible();
  await a.close();
  await v.close();
  await admin.close();
  await viewer.close();
});

test('共有ページが残る期限（最後の更新から90日）が、運営にも閲覧者にも共有の画面に出る', async ({ browser }) => {
  const admin = await browser.newContext();
  const viewer = await browser.newContext();
  await withIp(admin, '10.0.5.1');
  await withIp(viewer, '10.0.5.2');
  const a = await admin.newPage();
  const v = await viewer.newPage();
  acceptDialogs(a);
  acceptDialogs(v);
  await open(a);
  await makeTournament(a);
  await startShare(a);
  const link = await a.inputValue('#sh-link');
  const d = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const expected = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  // 共有を始めると大会データがすぐ送信され、その応答で期限が分かる
  await expect(a.locator('.sh-keep')).toContainText('まで残ります');
  await expect(a.locator('.sh-keep')).toContainText(expected);
  await a.click('#sh-close');

  await v.goto(link);
  await expect(v.locator('#bracket-wrap svg')).toBeVisible();
  await v.click('[data-action=share]');
  await untilSynced(v, () => expect(v.locator('.sh-keep')).toContainText(expected, { timeout: 1000 }));
  await a.close();
  await v.close();
  await admin.close();
  await viewer.close();
});

test('閲覧者は、最初から「自分の試合」を使える（運営はオフ）。名前を選ぶと次の試合が出て、表で強調される', async ({ browser }) => {
  const admin = await browser.newContext();
  const viewer = await browser.newContext();
  await withIp(admin, '10.0.9.1');
  await withIp(viewer, '10.0.9.2');
  const a = await admin.newPage();
  const v = await viewer.newPage();
  acceptDialogs(a);
  acceptDialogs(v);
  await open(a);
  await makeTournament(a);
  const code = await startShare(a);
  const link = await a.inputValue('#sh-link');
  await a.click('#sh-close');
  // 運営は、共有中でもオフのまま
  await expect(a.locator('#my-panel [data-my-toggle=on]')).toBeVisible();
  await expect(a.locator('#my-name')).toHaveCount(0);

  await v.goto(link);
  await expect(v.locator('#bracket-wrap svg')).toBeVisible();
  await expect(v.locator('#my-name')).toBeVisible(); // 閲覧者は最初から使える
  await expect(v.locator('#my-panel [data-my-toggle]')).toHaveCount(0); // 閲覧者には、オン・オフのボタンがない
  await v.fill('#my-name', NAMES[0]);
  await expect(v.locator('#my-cards .my-card')).toHaveCount(1);
  await expect(v.locator('#my-cards .my-card')).toContainText('あなたの次の試合');
  expect(await v.locator('.mine').count()).toBeGreaterThan(0);
  // 閲覧者は結果を変更できないまま（結果入力のダイアログは開かない）
  await v.locator('#panel-tournament .next-item').first().click();
  await expect(v.locator('#result-dialog')).not.toBeVisible();
  expect(code).toBeTruthy();
  await admin.close();
  await viewer.close();
});

test('運営が試合を開始すると、閲覧者にも「進行中」と卓の状況が見える。閲覧者には「開始」ボタンがない', async ({ browser }) => {
  const admin = await browser.newContext();
  const viewer = await browser.newContext();
  await withIp(admin, '10.0.10.1');
  await withIp(viewer, '10.0.10.2');
  const a = await admin.newPage();
  const v = await viewer.newPage();
  acceptDialogs(a);
  acceptDialogs(v);
  await open(a);
  await makeTournament(a);
  await startShare(a);
  const link = await a.inputValue('#sh-link');
  await a.click('#sh-close');
  await v.goto(link);
  await expect(v.locator('#bracket-wrap svg')).toBeVisible();
  await expect(v.locator('#panel-tournament .table-board .tc').first()).toContainText('空き');
  // 開始のボタンは、運営だけが押せる（閲覧者の画面では、どれも見えない）
  expect(await v.locator('#panel-tournament [data-start]').evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).length)).toBe(0);

  await a.locator('#panel-tournament .table-board .tc').first().locator('[data-start]').click(); // 第1卓の No.1
  await untilSynced(v, async () => {
    await expect(v.locator('#panel-tournament .table-board .tc.busy')).toHaveCount(1, { timeout: 1000 });
  });
  await expect(v.locator('#panel-tournament .table-board .tc.busy .badge-running')).toHaveText('進行中');
  await expect(v.locator('#panel-tournament .table-board .tc.busy')).toContainText('No.1');
  // 閲覧者には、「開始」「結果を入力」のボタンも出ない
  expect(await v.locator('#panel-tournament .tc-action button').evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).length)).toBe(0);
  await admin.close();
  await viewer.close();
});

test('運営が「元に戻す」を使うと、戻した内容が共有に送られ、閲覧者にも反映される。閲覧者には「元に戻す」が見えない', async ({ browser }) => {
  const admin = await browser.newContext();
  const viewer = await browser.newContext();
  await withIp(admin, '10.0.11.1');
  await withIp(viewer, '10.0.11.2');
  const a = await admin.newPage();
  const v = await viewer.newPage();
  acceptDialogs(a);
  acceptDialogs(v);
  await open(a);
  await makeTournament(a);
  await startShare(a);
  const link = await a.inputValue('#sh-link');
  await a.click('#sh-close');
  await v.goto(link);
  await expect(v.locator('#bracket-wrap svg')).toBeVisible();
  await expect(v.locator('#undo-btn')).toBeHidden(); // 閲覧者の画面には出ない

  await a.locator('.next-item').first().click();
  await enterScore(a, 2, 1);
  await expect(a.locator('#result-dialog')).not.toBeVisible();
  await untilSynced(v, async () => {
    await expect(v.locator('#panel-tournament .progress')).toContainText('1 / ', { timeout: 1000 });
    await expect(v.locator('#panel-tournament .progress')).not.toContainText('0 / ', { timeout: 1000 });
  });
  await a.click('#undo-btn');
  await expect(a.locator('#panel-tournament .progress')).toContainText('0 / ');
  await untilSynced(v, async () => {
    await expect(v.locator('#panel-tournament .progress')).toContainText('0 / ', { timeout: 1000 });
  });
  await admin.close();
  await viewer.close();
});

test('運営は、閲覧リンクのQRコードを大きく表示でき、PNGで保存できる。リンクが長すぎるときは開かない。閲覧者には出ない', async ({ browser }) => {
  const admin = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const viewer = await browser.newContext();
  await withIp(admin, '10.0.12.1');
  await withIp(viewer, '10.0.12.2');
  const a = await admin.newPage();
  const v = await viewer.newPage();
  acceptDialogs(a);
  acceptDialogs(v);
  await open(a);
  await a.fill('#meta-title', 'QRのテスト大会');
  await importNames(a, NAMES);
  await genTournament(a);
  await expect(a.locator('#panel-tournament .progress')).toBeVisible(); // スマホ幅では、表（SVG）でなく回戦ごとの表示
  await a.click('#menu-btn'); // スマホ幅では、共有はメニューの中
  await startShare(a);
  const link = await a.inputValue('#sh-link');

  await a.click('[data-sh=qr]');
  await expect(a.locator('#qr-dialog')).toBeVisible();
  await expect(a.locator('#qr-title')).toContainText('QRのテスト大会');
  await expect(a.locator('#qr-link')).toHaveText(link);
  await expect(a.locator('#qr-img svg')).toBeVisible();
  // 画面のQRコードは、このリンクから作ったものと同じ（core の生成処理と一致する）
  const expected = qrSvg(encodeQr(link)).svg.match(/<path d="([^"]+)"/)[1];
  expect(await a.locator('#qr-img path').getAttribute('d')).toBe(expected);
  // スマホ幅でも、画面内に収まり、読み取れる大きさ（一辺250px以上）で出る
  const box = await a.locator('#qr-img svg').boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(250);
  expect(Math.abs(box.width - box.height)).toBeLessThan(1.5);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // 「全画面」: ページ全体が全画面になり、QRコードがさらに大きくなる。もう一度押すと戻る
  await a.click('#qr-full');
  await expect.poll(() => a.evaluate(() => document.fullscreenElement?.tagName ?? null)).toBe('HTML');
  await expect(a.locator('#qr-dialog')).toBeVisible();
  const big = await a.locator('#qr-img svg').boundingBox();
  expect(big.width).toBeGreaterThan(box.width);
  await a.click('#qr-full');
  await expect.poll(() => a.evaluate(() => document.fullscreenElement?.tagName ?? null)).toBeNull();

  // PNGで保存できる（正方形の画像）
  const png = await download(a, '#qr-png');
  expect(png.name).toContain('閲覧リンクのQRコード');
  const size = pngSize(png.bytes);
  expect(size).not.toBeNull();
  expect(size.width).toBe(size.height);

  // 閉じると、QRコードとリンクを画面に残さない
  await a.click('#qr-close');
  await expect(a.locator('#qr-dialog')).not.toBeVisible();
  await expect(a.locator('#qr-img svg')).toHaveCount(0);

  // リンクが長すぎてQRコードにできないときは、通知を出して開かない
  await a.evaluate(() => { document.getElementById('sh-link').value = `https://example.com/#v=${'a'.repeat(300)}`; });
  await a.click('[data-sh=qr]');
  await expect(a.locator('#toast')).toContainText('長すぎて');
  await expect(a.locator('#qr-dialog')).not.toBeVisible();

  // 閲覧者の画面には、QRコードのボタンが出ない
  await a.click('#sh-close');
  await v.goto(link);
  await expect(v.locator('#bracket-wrap svg, #panel-tournament .progress').first()).toBeVisible();
  await v.click('[data-action=share]');
  await expect(v.locator('[data-sh=qr]')).toHaveCount(0);
  await admin.close();
  await viewer.close();
});
