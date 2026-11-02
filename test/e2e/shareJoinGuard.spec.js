import { test, expect } from '@playwright/test';
import { acceptDialogs, open } from './helpers.js';
import { FILE_KIND } from '../../src/core/state.js';

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
