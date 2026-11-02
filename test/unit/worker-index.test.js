// 共有サーバーの索引と、ポーリングの確認の計算（PR2・PLAN D61）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/src/index.js';
import { createD1 } from '../support/d1Shim.js';
import { createState } from '../../src/core/state.js';

const ADMIN = 'admin-pass-1';
const T0 = 1_800_000_000;

function setup() {
  const clock = { t: T0 };
  const env = { DB: createD1(), NOW: () => clock.t };
  const api = async (method, path, { token, body } = {}) => {
    const res = await worker.fetch(new Request(`https://x.test${path}`, {
      method,
      headers: { 'CF-Connecting-IP': '203.0.113.9', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { env, clock, api };
}

test('コメントの MAX(at) は、(code, at) の索引だけで読める（全件を読まない）', async () => {
  const { env, api } = setup();
  const r = await api('POST', '/api/rooms', { body: { adminPassword: ADMIN, title: 'x' } });
  assert.equal(r.status, 201);
  // 初期化（SCHEMA の適用）を済ませてから、プランを見る
  const plan = await env.DB.prepare('EXPLAIN QUERY PLAN SELECT MAX(at) AS last FROM comments WHERE code = ?').bind(r.data.code).all();
  const detail = plan.results.map((x) => x.detail).join(' | ');
  assert.match(detail, /COVERING INDEX idx_comments_code_at \(code=\?\)/, detail);
  assert.doesNotMatch(detail, /SCAN/, detail);
});

test('コメントが500件あっても、期限（最後のコメント＋90日）は最大の at で決まる', async () => {
  const { env, clock, api } = setup();
  const r = await api('POST', '/api/rooms', { body: { adminPassword: ADMIN, title: 'x' } });
  const code = r.data.code;
  const ins = env.DB.prepare('INSERT INTO comments (code, match_id, name, body, at, who) VALUES (?, NULL, ?, ?, ?, ?)');
  // 古い順に並べたうえで、最大の at は途中（100件目）に置く
  for (let i = 0; i < 500; i++) {
    const at = i === 100 ? T0 + 5000 : T0 - 1000 + i;
    await ins.bind(code, 'n', `c${i}`, at, 'w').run();
  }
  clock.t = T0 + 6000;
  const st = await api('GET', `/api/rooms/${code}/sync?rev=0&crev=0`, { token: r.data.token });
  const ttl = 90 * 24 * 60 * 60;
  // 大会データは作成直後（T0）に保存されている。コメントの最大 T0+5000 が勝つ
  assert.equal(st.data.keepUntil, T0 + 5000 + ttl);
});

test('SCHEMA は索引 idx_comments_code_at を作る（既存の DB にも効く）', async () => {
  const { env, api } = setup();
  await api('POST', '/api/rooms', { body: { adminPassword: ADMIN, title: 'x' } });
  const idx = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_comments_code_at'").all();
  assert.equal(idx.results.length, 1);
});

test('JSON の応答に X-Content-Type-Options: nosniff を付ける', async () => {
  const { env } = setup();
  const res = await worker.fetch(new Request('https://x.test/api/health'), env);
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('同じ秒に続けて大会データを送ると 429（rev 1以上）。rev 0 の最初の送信は判定しない', async () => {
  const { api, clock } = setup();
  const r = await api('POST', '/api/rooms', { body: { adminPassword: ADMIN, title: 'x' } });
  const put = () => api('PUT', `/api/rooms/${r.data.code}/state`, { token: r.data.token, body: { state: createState() } });
  // 共有を作った直後（同じ秒）の最初の送信は通る（rev 0）
  const first = await put();
  assert.equal(first.status, 200, JSON.stringify(first.data));
  // 同じ秒の2回目は止める（rev 1 以上）
  const again = await put();
  assert.equal(again.status, 429);
  // 1秒たてば送れる
  clock.t += 1;
  assert.equal((await put()).status, 200);
});

void createState;
