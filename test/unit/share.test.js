import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCode, normalizeBase, decideJoin, defaultBase, viewerLink, codeFromHash, commentTargets, targetLabel, formatCommentTime,
} from '../../src/core/share.js';
import { createState } from '../../src/core/state.js';
import { generateTournament } from '../../src/core/bracket.js';
import { generateLeague } from '../../src/core/league.js';

function stateWith(n) {
  const st = createState();
  st.players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `選手${i + 1}` }));
  const ids = st.players.map((p) => p.id);
  st.tournament = generateTournament(ids, { seedCount: 0, placement: 'order', thirdPlace: true });
  st.league = generateLeague(ids);
  return st;
}

test('共有コード: 空白・ハイフン・大文字を吸収し、紛らわしい文字や桁違いは不正', () => {
  assert.equal(normalizeCode(' K7M2-XQ9P '), 'k7m2xq9p');
  assert.equal(normalizeCode('k7m2xq9'), null);
  assert.equal(normalizeCode('k7m2xq9pp'), null);
  assert.equal(normalizeCode('k7m2xq0p'), null); // 0 は使わない
  assert.equal(normalizeCode('k7m2xqlp'), null); // l は使わない
  assert.equal(normalizeCode(null), null);
});

test('サーバーURL: origin だけにする。スキーム省略は https、変なスキームは拒否', () => {
  assert.deepEqual(normalizeBase(''), { ok: true, base: '' });
  assert.deepEqual(normalizeBase('https://tournament.abc.workers.dev/'), { ok: true, base: 'https://tournament.abc.workers.dev' });
  assert.deepEqual(normalizeBase('tournament.abc.workers.dev/path?x=1#y'), { ok: true, base: 'https://tournament.abc.workers.dev' });
  assert.deepEqual(normalizeBase('http://localhost:4174'), { ok: true, base: 'http://localhost:4174' });
  // http は手元の確認用（localhost・127.0.0.1・[::1]）だけ。それ以外は平文でパスワードとトークンが流れるため拒否（D62）
  assert.deepEqual(normalizeBase('http://127.0.0.1:4174'), { ok: true, base: 'http://127.0.0.1:4174' });
  assert.deepEqual(normalizeBase('http://[::1]:4174'), { ok: true, base: 'http://[::1]:4174' });
  for (const bad of ['http://evil.example.com', 'http://localhost.evil.com', 'http://localhost@evil.com', 'http://192.168.0.5']) {
    const r = normalizeBase(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.error, /https:\/\/ で始まる/, bad);
  }
  assert.equal(normalizeBase('javascript:alert(1)').ok, false);
  assert.equal(normalizeBase('ftp://example.com').ok, false);
  assert.equal(normalizeBase('http://').ok, false);
});

test('既定のサーバー: 同じサーバーで配信中ならそのオリジン。GitHub Pages・file:// は空', () => {
  const loc = (protocol, hostname, origin) => ({ protocol, hostname, origin });
  assert.equal(defaultBase(loc('https:', 'tournament.abc.workers.dev', 'https://tournament.abc.workers.dev')), 'https://tournament.abc.workers.dev');
  assert.equal(defaultBase(loc('http:', 'localhost', 'http://localhost:4174')), 'http://localhost:4174');
  assert.equal(defaultBase(loc('https:', 'bibi257.github.io', 'https://bibi257.github.io')), '');
  assert.equal(defaultBase(loc('file:', '', 'null')), '');
});

test('閲覧リンクと # からのコード取得は往復できる', () => {
  const link = viewerLink('https://t.example.workers.dev', 'k7m2xq9p');
  assert.equal(link, 'https://t.example.workers.dev/#v=k7m2xq9p');
  assert.equal(codeFromHash(new URL(link).hash), 'k7m2xq9p');
  assert.equal(codeFromHash('#v=K7M2-XQ9P'), 'k7m2xq9p');
  assert.equal(codeFromHash('#other'), null);
  assert.equal(codeFromHash(''), null);
  assert.equal(codeFromHash('#v=<script>'), null);
});

test('コメント対象: トーナメントの実試合（不戦を除く）と総当たりの全試合', () => {
  const st = stateWith(5); // 5人 → 枠8、1回戦の実試合は1つ
  const list = commentTargets(st);
  const t = list.filter((x) => x.group === 'トーナメント');
  const l = list.filter((x) => x.group === '総当たり');
  assert.equal(l.length, 10);
  assert.equal(t.length, 5); // 1回戦の実試合1 + 準決勝2 + 決勝1 + 3位決定戦1
  assert.ok(t.every((x) => !x.label.includes('（不戦）')));
  assert.ok(t.some((x) => x.id === '3P' && x.label.startsWith('3位決定戦')));
  assert.ok(t.some((x) => x.label.includes('（未定）')));
});

test('コメント対象: 参加者の改名が反映され、表にない試合は注記される', () => {
  const st = stateWith(4);
  st.players[0].name = '山田 太郎';
  const first = commentTargets(st).find((x) => x.group === 'トーナメント');
  assert.match(first.label, /山田 太郎/);
  assert.equal(targetLabel(st, ''), '');
  assert.equal(targetLabel(st, first.id), first.label);
  assert.equal(targetLabel(st, 'R9-M9'), '（その試合は表にありません）');
  assert.deepEqual(commentTargets(createState()), []);
});

test('コメント時刻は 月/日 時:分', () => {
  const sec = new Date(2026, 9, 17, 9, 5).getTime() / 1000;
  assert.equal(formatCommentTime(sec), '10/17 09:05');
});

// 運営ログインのとき、共有の既存データをどう扱うか（D62）
test('decideJoin: 共有が空なら push（この端末の内容を公開する）', () => {
  assert.equal(decideJoin(null, null), 'push');
  assert.equal(decideJoin('', null), 'push');
});

test('decideJoin: 共有のデータを読めるなら ask（読み込むか、公開し直すかを確認する）', () => {
  assert.equal(decideJoin('{"version":1}', { ok: true, state: {} }), 'ask');
});

test('decideJoin: 共有のデータが読めないなら blocked（上書きしない）', () => {
  assert.equal(decideJoin('{"version":99}', { ok: false, error: '新しい版' }), 'blocked');
  assert.equal(decideJoin('{"broken', { ok: false }), 'blocked');
});
