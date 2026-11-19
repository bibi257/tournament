import { test, expect } from '@playwright/test';
import { acceptDialogs, open, importNames } from './helpers.js';
import { FILE_KIND, createState, serializeState } from '../../src/core/state.js';
import { makePlayers } from '../../src/core/players.js';

// 運営ログインの安全確認（PR3・D62）: 共有に、このアプリで読めない新しい版のデータがあるとき、
// 運営としてログインしても、共有のデータを上書きしない
test.use({ baseURL: 'http://localhost:4174/' });

test('読めない（新しい版の）共有データは、運営ログインでも上書きしない', async ({ page, request }) => {
  acceptDialogs(page);
  const ip = `guard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const headers = { 'x-test-ip': ip };
  await page.setExtraHTTPHeaders(headers);

  // 新しい版（version 999）のデータを、API で直接入れておく
  const created = await request.post('/api/rooms', { headers, data: { adminPassword: 'admin-pass-1', title: '新しい版' } });
  expect(created.status()).toBe(201);
  const { code, token } = await created.json();
  const auth = { ...headers, Authorization: `Bearer ${token}` };
  const state = { kind: FILE_KIND, version: 999, players: [], tables: [], meta: { title: '新しい版' } };
  expect((await request.put(`/api/rooms/${code}/state`, { headers: auth, data: { state } })).status()).toBe(200);
  const read = async () => (await (await request.get(`/api/rooms/${code}/sync?rev=-1&crev=-1`, { headers: auth })).json());
  const before = await read();

  // 別の端末（この画面）から運営としてログイン
  await open(page);
  await page.click('[data-action=share]');
  await page.locator('.sh-details summary').first().click();
  await page.fill('#sh-code2', code);
  await page.fill('#sh-apw2', 'admin-pass-1');
  await page.click('[data-sh=admin]');
  await expect(page.locator('#toast')).toContainText('読めません');
  await expect(page.locator('.sh-code')).toHaveCount(0);

  // 共有のデータは変わっていない（版も中身も）
  const after = await read();
  expect(after.rev).toBe(before.rev);
  expect(after.state).toEqual(before.state);
});

// 公開済みのデータがある共有へ、別の端末から運営として入り直すとき。
// 以前は confirm で、キャンセル・Esc が「この端末の内容で公開し直す」だった（閉じただけで公開済みのデータが置き換わった）
test('公開済みのデータがある共有への運営ログインは、キャンセルではどちらも変えず、選んだときだけ読み込む・公開し直す', async ({ page, request }) => {
  acceptDialogs(page);
  const ip = `guard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const headers = { 'x-test-ip': ip };
  await page.setExtraHTTPHeaders(headers);

  // 公開済みのデータ（2人の名簿）を、API で入れておく
  const created = await request.post('/api/rooms', { headers, data: { adminPassword: 'admin-pass-1', title: '公開済み' } });
  expect(created.status()).toBe(201);
  const { code, token } = await created.json();
  const auth = { ...headers, Authorization: `Bearer ${token}` };
  const published = createState();
  published.meta.title = '公開済み';
  published.players = makePlayers(['公開 太郎', '公開 花子']);
  expect((await request.put(`/api/rooms/${code}/state`, { headers: auth, data: { state: JSON.parse(serializeState(published)) } })).status()).toBe(200);
  const read = async () => (await (await request.get(`/api/rooms/${code}/sync?rev=-1&crev=-1`, { headers: auth })).json());
  const before = await read();

  // 別の端末（この画面。名簿は別の1人）から運営としてログイン
  await open(page);
  await importNames(page, ['この端末 一郎']);
  const login = async () => {
    await page.click('[data-action=share]');
    await page.locator('.sh-details summary').first().click();
    await page.fill('#sh-code2', code);
    await page.fill('#sh-apw2', 'admin-pass-1');
    await page.click('[data-sh=admin]');
    await expect(page.locator('#choice-dialog')).toBeVisible();
  };

  // Esc で閉じる: 公開済みのデータも、この端末のデータも変わらない。運営セッションも残らない
  await login();
  await page.keyboard.press('Escape');
  await expect(page.locator('#toast')).toContainText('取りやめました');
  await expect(page.locator('.sh-code')).toHaveCount(0);
  let now = await read();
  expect(now.rev).toBe(before.rev);
  expect(now.state).toEqual(before.state);
  await page.click('#sh-close');
  await expect(page.locator('#player-count')).toHaveText('1人');
  await page.reload();
  await expect(page.locator('#share-chip')).toBeHidden();
  now = await read();
  expect(now.rev).toBe(before.rev);

  // 「キャンセル」ボタンでも同じ
  await login();
  await page.click('#ch-cancel');
  await expect(page.locator('.sh-code')).toHaveCount(0);
  expect((await read()).rev).toBe(before.rev);
  await page.click('#sh-close');

  // 「公開済みの内容を、この端末に読み込む」（最初の選択肢）: この端末の名簿が公開済みの2人になる
  await login();
  await expect(page.locator('input[name=ch-choice]').first()).toBeChecked();
  await page.click('#ch-ok');
  await expect(page.locator('.sh-code')).toHaveText(code);
  await page.click('#sh-close');
  await expect(page.locator('#player-count')).toHaveText('2人');
  await expect(page.locator('input.name').first()).toHaveValue('公開 太郎');

  // 「この端末の内容で公開し直す」: 公開済みのデータが、この端末の内容になる
  await page.click('[data-action=share]');
  await page.click('[data-sh=disconnect]');
  await page.click('#sh-close');
  await importNames(page, ['この端末 一郎'], 'replace');
  await login();
  await page.check('input[name=ch-choice][value=push]');
  await page.click('#ch-ok');
  await expect(page.locator('.sh-code')).toHaveText(code);
  await expect.poll(async () => (await read()).state.players.map((p) => p.name)).toEqual(['この端末 一郎']);
});
