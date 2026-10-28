import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/src/index.js';
import { createD1 } from '../support/d1Shim.js';
import { createState } from '../../src/core/state.js';

const ADMIN = 'admin-pass-1';

function setup() {
  const clock = { t: 1_800_000_000 };
  const env = { DB: createD1(), NOW: () => clock.t };
  let ip = '203.0.113.1';
  const api = async (method, path, { token, body, headers } = {}) => {
    const res = await worker.fetch(new Request(`https://x.test${path}`, {
      method,
      headers: { 'CF-Connecting-IP': ip, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }), env);
    return { status: res.status, headers: res.headers, data: await res.json().catch(() => null) };
  };
  return { env, clock, api, setIp: (v) => { ip = v; } };
}

async function newRoom(api, extra = {}) {
  const r = await api('POST', '/api/rooms', { body: { adminPassword: ADMIN, title: '春季大会', ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}

/** 閲覧者の入場（パスワードなし） */
async function viewerToken(api, code) {
  const r = await api('POST', `/api/rooms/${code}/join`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.role, 'viewer');
  return r.data.token;
}

const sampleState = (title = '春季大会') => {
  const st = createState();
  st.meta.title = title;
  st.players = [{ id: 'p1', name: '山田' }, { id: 'p2', name: '佐藤' }];
  return st;
};

test('共有を作ると 8 文字のコードと運営トークンが返る', async () => {
  const { api } = setup();
  const r = await newRoom(api);
  assert.match(r.code, /^[a-hj-km-np-z2-9]{8}$/);
  assert.equal(r.role, 'admin');
  assert.ok(r.token.includes('.'));
});

test('運営用パスワードの強さを検査する。閲覧用パスワードは不要（送られても使わない）', async () => {
  const { api } = setup();
  const post = (body) => api('POST', '/api/rooms', { body });
  assert.equal((await post({ adminPassword: 'abc' })).status, 400);
  assert.equal((await post({ adminPassword: 'x'.repeat(65) })).status, 400);
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ adminPassword: ADMIN, viewerPassword: 'ignored' })).status, 201);
});

test('不正な JSON は 400、大きすぎる本文は 413', async () => {
  const { api } = setup();
  assert.equal((await api('POST', '/api/rooms', { body: '{oops' })).status, 400);
  assert.equal((await api('POST', '/api/rooms', { body: '[1]' })).status, 400);
  assert.equal((await api('POST', '/api/rooms', { body: JSON.stringify({ title: 'a'.repeat(9000) }) })).status, 413);
});

test('運営ログイン: 正しい運営用パスワードで入れる。共有コードは大文字でも通る', async () => {
  const { api } = setup();
  const { code } = await newRoom(api);
  const a = await api('POST', `/api/rooms/${code}/login`, { body: { password: ADMIN } });
  assert.equal(a.status, 200);
  assert.equal(a.data.role, 'admin');
  const up = await api('POST', `/api/rooms/${code.toUpperCase()}/login`, { body: { password: ADMIN } });
  assert.equal(up.status, 200);
});

test('運営ログイン: 間違いと、存在しない共有コードは区別のつかない応答', async () => {
  const { api } = setup();
  const { code } = await newRoom(api);
  const wrong = await api('POST', `/api/rooms/${code}/login`, { body: { password: 'wrong-pass' } });
  assert.equal(wrong.status, 401);
  const noRoom = await api('POST', '/api/rooms/abcdefgh/login', { body: { password: ADMIN } });
  assert.equal(noRoom.status, 401);
  assert.equal(noRoom.data.error, wrong.data.error);
});

test('運営ログイン: 5回までは待たせず、6回目の失敗から待ち時間が始まる。正しい入力は待ちの間は拒否される', async () => {
  const { api, clock } = setup();
  const { code } = await newRoom(api);
  for (let i = 0; i < 6; i++) {
    assert.equal((await api('POST', `/api/rooms/${code}/login`, { body: { password: 'wrong-pass' } })).status, 401);
  }
  const locked = await api('POST', `/api/rooms/${code}/login`, { body: { password: ADMIN } });
  assert.equal(locked.status, 429);
  clock.t += 29;
  assert.equal((await api('POST', `/api/rooms/${code}/login`, { body: { password: ADMIN } })).status, 429);
  clock.t += 2;
  assert.equal((await api('POST', `/api/rooms/${code}/login`, { body: { password: ADMIN } })).status, 200);
});

test('運営ログイン: 待ち時間は失敗のたびに2倍になり、1時間で止まる。成功すると数えが消える', async () => {
  const { api, clock } = setup();
  const { code } = await newRoom(api);
  const wrong = () => api('POST', `/api/rooms/${code}/login`, { body: { password: 'wrong-pass' } });
  for (let i = 0; i < 5; i++) await wrong();
  assert.equal((await wrong()).status, 401); // 6回目: 30秒
  clock.t += 31;
  assert.equal((await wrong()).status, 401); // 7回目: 60秒
  clock.t += 59;
  assert.equal((await api('POST', `/api/rooms/${code}/login`, { body: { password: ADMIN } })).status, 429);
  clock.t += 2;
  for (let i = 0; i < 20; i++) { clock.t += 3600; await wrong(); } // 十数回の失敗のあとも、待ちは1時間まで
  clock.t += 3601;
  assert.equal((await wrong()).status, 401);
  clock.t += 3601;
  assert.equal((await api('POST', `/api/rooms/${code}/login`, { body: { password: ADMIN } })).status, 200);
  for (let i = 0; i < 5; i++) await wrong(); // 成功のあとは数えが0から
  assert.equal((await wrong()).status, 401);
  assert.equal((await api('POST', `/api/rooms/${code}/login`, { body: { password: ADMIN } })).status, 429);
});

test('運営ログイン: ある IP の失敗は、別の IP からの正しい入力を止めない（共有コード全体のロックはしない）', async () => {
  const { api, setIp } = setup();
  const { code } = await newRoom(api);
  for (let ip = 1; ip <= 6; ip++) {
    setIp(`198.51.100.${ip}`);
    for (let k = 0; k < 10; k++) await api('POST', `/api/rooms/${code}/login`, { body: { password: 'wrong-pass' } });
    assert.equal((await api('POST', `/api/rooms/${code}/login`, { body: { password: ADMIN } })).status, 429, `IP ${ip} は止まる`);
  }
  setIp('192.0.2.77');
  assert.equal((await api('POST', `/api/rooms/${code}/login`, { body: { password: ADMIN } })).status, 200);
});

test('閲覧者の入場: パスワードなしで入れるが、権限は閲覧のみ', async () => {
  const { api } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);
  assert.equal((await api('GET', `/api/rooms/${r.code}/sync?rev=-1&crev=-1`, { token: vt })).status, 200);
  assert.equal((await api('PUT', `/api/rooms/${r.code}/state`, { token: vt, body: { state: sampleState() } })).status, 403);
  assert.equal((await api('PUT', `/api/rooms/${r.code}/passwords`, { token: vt, body: { password: 'new-admin-pw' } })).status, 403);
  assert.equal((await api('DELETE', `/api/rooms/${r.code}`, { token: vt })).status, 403);
  // 大文字の共有コードでも入れる
  assert.equal((await api('POST', `/api/rooms/${r.code.toUpperCase()}/join`)).status, 200);
});

test('閲覧者の入場: 存在しない共有コードは 404。続けて試すと IP ごとに止まる', async () => {
  const { api, clock, setIp } = setup();
  const r = await newRoom(api);
  const miss = await api('POST', '/api/rooms/abcdefgh/join');
  assert.equal(miss.status, 404);
  assert.match(miss.data.error, /見つかりません/);
  for (let i = 0; i < 29; i++) await api('POST', '/api/rooms/abcdefgh/join');
  assert.equal((await api('POST', '/api/rooms/abcdefgh/join')).status, 429);
  // 止まっている間は、正しい共有コードでも同じ IP は入れない。別の IP は影響を受けない
  assert.equal((await api('POST', `/api/rooms/${r.code}/join`)).status, 429);
  setIp('198.51.100.20');
  assert.equal((await api('POST', `/api/rooms/${r.code}/join`)).status, 200);
  setIp('203.0.113.1');
  clock.t += 601;
  assert.equal((await api('POST', `/api/rooms/${r.code}/join`)).status, 200);
});

test('認証なし・改ざん・他の共有のトークンは 401、期限切れも 401', async () => {
  const { api, clock } = setup();
  const a = await newRoom(api);
  const b = await newRoom(api);
  assert.equal((await api('GET', `/api/rooms/${a.code}/sync`)).status, 401);
  assert.equal((await api('GET', `/api/rooms/${a.code}/sync`, { token: a.token.slice(0, -2) + 'xx' })).status, 401);
  assert.equal((await api('GET', `/api/rooms/${a.code}/sync`, { token: b.token })).status, 401);
  assert.equal((await api('GET', `/api/rooms/${a.code}/sync`, { token: a.token })).status, 200);
  clock.t += 12 * 3600 + 1;
  assert.equal((await api('GET', `/api/rooms/${a.code}/sync`, { token: a.token })).status, 401);
});

test('大会データの公開と取得: 変化があったときだけ本体を返す', async () => {
  const { api } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);

  const empty = await api('GET', `/api/rooms/${r.code}/sync?rev=-1&crev=-1`, { token: vt });
  assert.equal(empty.data.rev, 0);
  assert.equal(empty.data.state, null);

  const put = await api('PUT', `/api/rooms/${r.code}/state`, { token: r.token, body: { state: sampleState() } });
  assert.equal(put.status, 200);
  assert.equal(put.data.rev, 1);

  const got = await api('GET', `/api/rooms/${r.code}/sync?rev=0&crev=0`, { token: vt });
  assert.equal(got.data.rev, 1);
  assert.equal(got.data.title, '春季大会');
  assert.equal(got.data.state.players[0].name, '山田');

  const same = await api('GET', `/api/rooms/${r.code}/sync?rev=1&crev=0`, { token: vt });
  assert.equal('state' in same.data, false);
  assert.equal('comments' in same.data, false);
});

test('大会データの公開は運営だけ。形式と大きさも検査する', async () => {
  const { api } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);
  const path = `/api/rooms/${r.code}/state`;
  assert.equal((await api('PUT', path, { token: vt, body: { state: sampleState() } })).status, 403);
  assert.equal((await api('PUT', path, { token: r.token, body: { state: { hello: 1 } } })).status, 400);
  assert.equal((await api('PUT', path, { token: r.token, body: {} })).status, 400);
  const big = sampleState();
  big.players = Array.from({ length: 30000 }, (_, i) => ({ id: `p${i}`, name: 'あ'.repeat(10) }));
  assert.equal((await api('PUT', path, { token: r.token, body: { state: big } })).status, 413);
});

test('コメント: 投稿・一覧・名前の既定値・対象の指定', async () => {
  const { api } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);
  const post = (body, token = vt) => api('POST', `/api/rooms/${r.code}/comments`, { token, body });
  assert.equal((await post({ name: '見学者', text: '頑張れ！', matchId: 'R1-M1' })).status, 201);
  assert.equal((await post({ name: '  ', text: '全体へのコメント' })).status, 201);
  const sync = await api('GET', `/api/rooms/${r.code}/sync?rev=0&crev=0`, { token: vt });
  assert.equal(sync.data.comments.length, 2);
  assert.deepEqual(sync.data.comments.map((c) => [c.name, c.text, c.matchId]), [['見学者', '頑張れ！', 'R1-M1'], ['名無し', '全体へのコメント', null]]);
  assert.equal(sync.data.crev, 2);
});

test('コメント: 空・長すぎ・不正な対象・制御文字を弾く/除く', async () => {
  const { api } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);
  const post = (body) => api('POST', `/api/rooms/${r.code}/comments`, { token: vt, body });
  assert.equal((await post({ text: '   ' })).status, 400);
  assert.equal((await post({ text: 'あ'.repeat(201) })).status, 400);
  assert.equal((await post({ name: 'あ'.repeat(21), text: 'ok' })).status, 400);
  assert.equal((await post({ text: 'ok', matchId: '<script>' })).status, 400);
  assert.equal((await post({ text: '良い\u0000試合‮でした\n\n\n\n次' })).status, 201);
  const s = await api('GET', `/api/rooms/${r.code}/sync?rev=0&crev=0`, { token: vt });
  assert.equal(s.data.comments[0].text, '良い試合でした\n\n次');
  // HTML はそのまま保存する（表示側でエスケープする）。サーバーが勝手に変形しない
  assert.equal((await post({ name: '<b>x</b>', text: '<img src=x onerror=alert(1)>' })).status, 201);
});

test('コメント: 続けて投稿すると制限され、1分後に再開できる', async () => {
  const { api, clock } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);
  const post = () => api('POST', `/api/rooms/${r.code}/comments`, { token: vt, body: { text: 'a' } });
  for (let i = 0; i < 6; i++) assert.equal((await post()).status, 201);
  assert.equal((await post()).status, 429);
  clock.t += 61;
  assert.equal((await post()).status, 201);
});

test('コメント: 1つの共有に 500 件まで', async () => {
  const { api, env } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);
  await env.DB.batch(Array.from({ length: 500 }, (_, i) =>
    env.DB.prepare('INSERT INTO comments (code, match_id, name, body, at, who) VALUES (?, NULL, ?, ?, 1, ?)').bind(r.code, 'n', `c${i}`, 'w')));
  const res = await api('POST', `/api/rooms/${r.code}/comments`, { token: vt, body: { text: 'もう1件' } });
  assert.equal(res.status, 429);
  const s = await api('GET', `/api/rooms/${r.code}/sync?rev=0&crev=-1`, { token: vt });
  assert.equal(s.data.comments.length, 300);
  assert.equal(s.data.comments.at(-1).text, 'c499');
});

test('コメントの削除は運営だけで、他の共有のコメントは消せない', async () => {
  const { api } = setup();
  const a = await newRoom(api);
  const b = await newRoom(api);
  const vt = await viewerToken(api, a.code);
  const posted = await api('POST', `/api/rooms/${a.code}/comments`, { token: vt, body: { text: 'x' } });
  const id = posted.data.id;
  assert.equal((await api('DELETE', `/api/rooms/${a.code}/comments/${id}`, { token: vt })).status, 403);
  const other = await api('DELETE', `/api/rooms/${b.code}/comments/${id}`, { token: b.token });
  assert.equal(other.data.deleted, 0);
  const del = await api('DELETE', `/api/rooms/${a.code}/comments/${id}`, { token: a.token });
  assert.equal(del.data.deleted, 1);
  const s = await api('GET', `/api/rooms/${a.code}/sync?rev=0&crev=0`, { token: vt });
  assert.deepEqual(s.data.comments, []);
  assert.equal(s.data.crev, 2);
});

test('運営用パスワードの変更: 古い運営トークンは使えなくなり、新しいトークンが返る。閲覧者は影響を受けない', async () => {
  const { api } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);
  const path = `/api/rooms/${r.code}/passwords`;
  assert.equal((await api('PUT', path, { token: r.token, body: { password: 'short' } })).status, 400);

  const changed = await api('PUT', path, { token: r.token, body: { password: 'new-admin-pw' } });
  assert.equal(changed.status, 200);
  assert.equal((await api('GET', `/api/rooms/${r.code}/sync`, { token: r.token })).status, 401);
  assert.equal((await api('GET', `/api/rooms/${r.code}/sync`, { token: changed.data.token })).status, 200);
  assert.equal((await api('GET', `/api/rooms/${r.code}/sync`, { token: vt })).status, 200);
  assert.equal((await api('POST', `/api/rooms/${r.code}/login`, { body: { password: ADMIN } })).status, 401);
  assert.equal((await api('POST', `/api/rooms/${r.code}/login`, { body: { password: 'new-admin-pw' } })).status, 200);
});

test('共有の終了: 大会データとコメントが消え、トークンも使えなくなる', async () => {
  const { api, env } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);
  await api('POST', `/api/rooms/${r.code}/comments`, { token: vt, body: { text: 'x' } });
  assert.equal((await api('DELETE', `/api/rooms/${r.code}`, { token: vt })).status, 403);
  assert.equal((await api('DELETE', `/api/rooms/${r.code}`, { token: r.token })).status, 200);
  assert.equal((await api('GET', `/api/rooms/${r.code}/sync`, { token: vt })).status, 404);
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM comments').first('n'), 0);
});

test('共有の作成は1時間に5回まで', async () => {
  const { api, clock, setIp } = setup();
  for (let i = 0; i < 5; i++) await newRoom(api);
  const sixth = await api('POST', '/api/rooms', { body: { adminPassword: ADMIN } });
  assert.equal(sixth.status, 429);
  setIp('198.51.100.7');
  assert.equal((await api('POST', '/api/rooms', { body: { adminPassword: ADMIN } })).status, 201);
  setIp('203.0.113.1');
  clock.t += 3601;
  assert.equal((await api('POST', '/api/rooms', { body: { adminPassword: ADMIN } })).status, 201);
});

test('90日更新のない共有は、次に共有を作るときに削除される', async () => {
  const { api, clock, env, setIp } = setup();
  const old = await newRoom(api);
  clock.t += 91 * 24 * 3600;
  setIp('198.51.100.9');
  await newRoom(api);
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM rooms WHERE code = ?').bind(old.code).first('n'), 0);
});

test('運営用パスワードは平文で保存されない。閲覧用の列は使わない', async () => {
  const { api, env } = setup();
  const r = await newRoom(api);
  const row = await env.DB.prepare('SELECT viewer_pw, admin_pw FROM rooms WHERE code = ?').bind(r.code).first();
  assert.match(row.admin_pw, /^\d+\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.ok(!row.admin_pw.includes(ADMIN));
  assert.equal(row.viewer_pw, '');
});

test('CORS: プリフライトと通常応答にヘッダーが付く。/api 以外は ASSETS に渡す', async () => {
  const { api, env } = setup();
  const pre = await api('OPTIONS', '/api/rooms');
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  const health = await api('GET', '/api/health');
  assert.equal(health.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(health.headers.get('Cache-Control'), 'no-store');
  assert.equal((await api('GET', '/api/unknown')).status, 404);
  assert.equal((await api('GET', '/api/rooms/zzz/sync')).status, 404);

  const calls = [];
  const res = await worker.fetch(new Request('https://x.test/index.html'), { ...env, ASSETS: { fetch: async (r) => { calls.push(r.url); return new Response('asset'); } } });
  assert.equal(await res.text(), 'asset');
  assert.equal(calls.length, 1);
});

test('同時に2回公開しても版番号は重ならない（閲覧者が後の更新を取りこぼさない）', async () => {
  const { api, env } = setup();
  const r = await newRoom(api);
  const path = `/api/rooms/${r.code}/state`;
  // 2つの要求がどちらも書き込みの直前まで進んでから書くようにして、同時実行を再現する
  const prepare = env.DB.prepare;
  let waiting = 0;
  let release;
  const bothReady = new Promise((res) => { release = res; });
  const gate = async () => { if (++waiting === 2) release(); await bothReady; };
  env.DB.prepare = (sql) => {
    const st = prepare(sql);
    if (!sql.startsWith('UPDATE rooms SET state')) return st;
    return { bind: (...p) => {
      const b = st.bind(...p);
      return { run: async () => { await gate(); return b.run(); }, first: async (c) => { await gate(); return b.first(c); } };
    } };
  };
  const [a, b] = await Promise.all([
    api('PUT', path, { token: r.token, body: { state: sampleState('A') } }),
    api('PUT', path, { token: r.token, body: { state: sampleState('B') } }),
  ]);
  env.DB.prepare = prepare;
  assert.deepEqual([a.data.rev, b.data.rev].sort(), [1, 2]);
  const vt = await viewerToken(api, r.code);
  const got = await api('GET', `/api/rooms/${r.code}/sync?rev=-1&crev=-1`, { token: vt });
  assert.equal(got.data.rev, 2);
});

test('90日更新のない共有は、削除される前でも入れない・見られない', async () => {
  const { api, clock } = setup();
  const r = await newRoom(api);
  // 期限の1時間前に入場（トークンは12時間有効）→ 2時間後は共有の期限切れ
  clock.t += 90 * 24 * 3600 - 3600;
  const vt = await viewerToken(api, r.code);
  clock.t += 2 * 3600;
  assert.equal((await api('GET', `/api/rooms/${r.code}/sync?rev=-1&crev=-1`, { token: vt })).status, 404);
  assert.equal((await api('POST', `/api/rooms/${r.code}/join`)).status, 404);
  assert.equal((await api('POST', `/api/rooms/${r.code}/login`, { body: { password: ADMIN } })).status, 401);
});

test('同期の応答に、共有ページが残る期限（最後の更新から90日）が入る。公開するたびに延びる', async () => {
  const { api, clock } = setup();
  const room = await newRoom(api);
  const DAY = 24 * 60 * 60;
  const first = await api('GET', `/api/rooms/${room.code}/sync?rev=0&crev=0`, { token: room.token });
  assert.equal(first.data.keepUntil, first.data.updatedAt + 90 * DAY);
  clock.t += 10 * DAY;
  const login = await api('POST', `/api/rooms/${room.code}/login`, { body: { password: ADMIN } }); // 運営トークンは12時間で切れる
  const token = login.data.token;
  const put = await api('PUT', `/api/rooms/${room.code}/state`, { token, body: { state: sampleState() } });
  assert.equal(put.data.keepUntil, clock.t + 90 * DAY);
  const after = await api('GET', `/api/rooms/${room.code}/sync?rev=0&crev=0`, { token });
  assert.equal(after.data.updatedAt, clock.t);
  assert.equal(after.data.keepUntil, clock.t + 90 * DAY);
  // 閲覧者にも同じ期限が返る
  const v = await viewerToken(api, room.code);
  const vs = await api('GET', `/api/rooms/${room.code}/sync?rev=0&crev=0`, { token: v });
  assert.equal(vs.data.keepUntil, clock.t + 90 * DAY);
});

test('コメントがあれば、大会データを送らなくても共有は続く（期限はコメントから90日）', async () => {
  const { api, clock } = setup();
  const r = await newRoom(api);
  const DAY = 24 * 60 * 60;
  const t0 = clock.t;
  clock.t += 80 * DAY;
  const vt = await viewerToken(api, r.code);
  assert.equal((await api('POST', `/api/rooms/${r.code}/comments`, { token: vt, body: { text: 'がんばれ' } })).status, 201);
  clock.t += 89 * DAY; // 作成から169日。大会データの送信からは169日だが、コメントからは89日
  const v2 = await viewerToken(api, r.code);
  const s = await api('GET', `/api/rooms/${r.code}/sync?rev=-1&crev=-1`, { token: v2 });
  assert.equal(s.status, 200);
  assert.equal(s.data.keepUntil, t0 + 80 * DAY + 90 * DAY);
  clock.t += 2 * DAY; // コメントから91日
  assert.equal((await api('POST', `/api/rooms/${r.code}/join`)).status, 404);
});

test('コメントの対象は、読み込める試合 ID（_ を含む・64字まで）を受け付ける', async () => {
  const { api } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);
  const post = (matchId) => api('POST', `/api/rooms/${r.code}/comments`, { token: vt, body: { text: 'ok', matchId } });
  assert.equal((await post('L_1')).status, 201);
  assert.equal((await post('a'.repeat(64))).status, 201);
  assert.equal((await post('a'.repeat(65))).status, 400);
});

// ---- 試合結果の報告（F8） ----

const report = (over = {}) => ({ name: '見学者', matchId: 'R1-M1', outcome: 'p1', score1: 3, score2: 1, p1: 'p1', p2: 'p2', ...over });

test('結果の報告: 閲覧者が送れて、一覧は運営にだけ返る（閲覧者には返らない）', async () => {
  const { api } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);
  const sent = await api('POST', `/api/rooms/${r.code}/reports`, { token: vt, body: report() });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  const admin = await api('GET', `/api/rooms/${r.code}/sync?rev=0&crev=0`, { token: r.token });
  assert.deepEqual(admin.data.reports.map((x) => [x.matchId, x.outcome, x.score1, x.score2, x.p1, x.p2, x.name]),
    [['R1-M1', 'p1', 3, 1, 'p1', 'p2', '見学者']]);
  const viewer = await api('GET', `/api/rooms/${r.code}/sync?rev=0&crev=0`, { token: vt });
  assert.equal('reports' in viewer.data, false);
  assert.equal(admin.data.crev, 1); // 運営の画面が更新に気づける
});

test('結果の報告: 大会データ（結果）は書き換えない', async () => {
  const { api } = setup();
  const r = await newRoom(api);
  await api('PUT', `/api/rooms/${r.code}/state`, { token: r.token, body: { state: sampleState() } });
  const vt = await viewerToken(api, r.code);
  const before = await api('GET', `/api/rooms/${r.code}/sync?rev=-1&crev=0`, { token: vt });
  await api('POST', `/api/rooms/${r.code}/reports`, { token: vt, body: report() });
  const after = await api('GET', `/api/rooms/${r.code}/sync?rev=-1&crev=0`, { token: vt });
  assert.equal(after.data.rev, before.data.rev);
  assert.deepEqual(after.data.state, before.data.state);
});

test('結果の報告: 勝者もスコアも無い・スコアと勝者の矛盾・不正な対象や対戦者を弾く', async () => {
  const { api } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);
  const post = (body) => api('POST', `/api/rooms/${r.code}/reports`, { token: vt, body });
  assert.equal((await post(report({ outcome: null, score1: null, score2: null }))).status, 400);
  assert.equal((await post(report({ outcome: 'p2' }))).status, 400); // 3-1 なのに p2 の勝ち
  assert.equal((await post(report({ score1: 3, score2: null }))).status, 400);
  assert.equal((await post(report({ score1: -1, score2: 0 }))).status, 400);
  assert.equal((await post(report({ matchId: '<script>' }))).status, 400);
  assert.equal((await post(report({ matchId: '' }))).status, 400);
  assert.equal((await post(report({ p1: '"><x' }))).status, 400);
  assert.equal((await post(report({ name: 'あ'.repeat(21) }))).status, 400);
  assert.equal((await post(report({ outcome: 'p1', score1: null, score2: null }))).status, 201); // 勝者だけでもよい
  assert.equal((await post(report({ outcome: 'zzz', score1: null, score2: null }))).status, 400); // 勝敗は p1・p2・draw のどれか
  assert.equal((await post(report({ outcome: { x: 1 }, score1: null, score2: null }))).status, 400);
});

test('結果の報告: 同じ人が同じ試合を2回は送れない。1試合 3 件まで、1共有 60 件まで', async () => {
  const { api, env, setIp } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);
  const post = (body) => api('POST', `/api/rooms/${r.code}/reports`, { token: vt, body });
  assert.equal((await post(report())).status, 201);
  assert.equal((await post(report())).status, 409);
  assert.equal((await post(report({ matchId: 'R1-M2' }))).status, 201); // 別の試合は送れる
  for (const ip of ['198.51.100.1', '198.51.100.2']) {
    setIp(ip);
    assert.equal((await post(report())).status, 201);
  }
  setIp('198.51.100.3');
  assert.equal((await post(report())).status, 429); // この試合は 3 件で打ち止め
  await env.DB.batch(Array.from({ length: 60 }, (_, i) =>
    env.DB.prepare('INSERT INTO reports (code, match_id, outcome, p1, p2, name, at, who) VALUES (?, ?, ?, NULL, NULL, ?, 1, ?)').bind(r.code, `X${i}`, 'p1', 'n', `w${i}`)));
  assert.equal((await post(report({ matchId: 'R2-M1' }))).status, 429);
});

test('結果の報告: 続けて送ると制限され、1分後に再開できる', async () => {
  const { api, clock } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);
  const post = (n) => api('POST', `/api/rooms/${r.code}/reports`, { token: vt, body: report({ matchId: `R1-M${n}` }) });
  for (let n = 1; n <= 4; n++) assert.equal((await post(n)).status, 201);
  assert.equal((await post(5)).status, 429);
  clock.t += 61;
  assert.equal((await post(5)).status, 201);
});

test('結果の報告の削除（承認したあと・却下）は運営だけ。他の共有の報告は消せない', async () => {
  const { api } = setup();
  const a = await newRoom(api);
  const b = await newRoom(api);
  const vt = await viewerToken(api, a.code);
  const id = (await api('POST', `/api/rooms/${a.code}/reports`, { token: vt, body: report() })).data.id;
  assert.equal((await api('DELETE', `/api/rooms/${a.code}/reports/${id}`, { token: vt })).status, 403);
  assert.equal((await api('DELETE', `/api/rooms/${b.code}/reports/${id}`, { token: b.token })).data.deleted, 0);
  assert.equal((await api('DELETE', `/api/rooms/${a.code}/reports/${id}`, { token: a.token })).data.deleted, 1);
  const s = await api('GET', `/api/rooms/${a.code}/sync?rev=0&crev=0`, { token: a.token });
  assert.deepEqual(s.data.reports, []);
  assert.equal(s.data.crev, 2);
});

test('結果の報告: 共有の終了で消える。報告だけでは共有の期限は延びない', async () => {
  const { api, env, clock } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);
  const before = (await api('GET', `/api/rooms/${r.code}/sync?rev=0&crev=0`, { token: r.token })).data.keepUntil;
  clock.t += 3600;
  await api('POST', `/api/rooms/${r.code}/reports`, { token: vt, body: report() });
  const after = (await api('GET', `/api/rooms/${r.code}/sync?rev=0&crev=0`, { token: r.token })).data.keepUntil;
  assert.equal(after, before);
  await api('DELETE', `/api/rooms/${r.code}`, { token: r.token });
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM reports').first('n'), 0);
});

test('結果の報告: 運営用パスワードの変更後、古い運営トークンでは報告の一覧も削除もできない', async () => {
  const { api } = setup();
  const r = await newRoom(api);
  const vt = await viewerToken(api, r.code);
  const id = (await api('POST', `/api/rooms/${r.code}/reports`, { token: vt, body: report() })).data.id;
  await api('PUT', `/api/rooms/${r.code}/passwords`, { token: r.token, body: { password: 'new-pass-22' } });
  assert.equal((await api('GET', `/api/rooms/${r.code}/sync?rev=0&crev=0`, { token: r.token })).status, 401);
  assert.equal((await api('DELETE', `/api/rooms/${r.code}/reports/${id}`, { token: r.token })).status, 401);
});
