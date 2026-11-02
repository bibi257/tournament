// 画面の Content-Security-Policy と、インラインの実行を含まないことを確かめる（PR3・D62）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
const csp = (html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i) || [])[1] || '';
const directive = (name) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' ')) || '');

test('index.html に CSP の meta がある', () => {
  assert.ok(csp, 'meta http-equiv="Content-Security-Policy" が必要');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'none'/);
});

test('script-src に unsafe-inline・unsafe-eval が無い', () => {
  const s = directive('script-src');
  assert.equal(s, "script-src 'self'");
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-(inline|eval)'/);
});

test('インラインの script と on*= 属性が無い（index.html・画面のテンプレート）', () => {
  // 外部の script（src）だけ
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) assert.match(m[1], /\bsrc=/, 'インラインの script は使わない');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'on*= 属性は使わない');
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  for (const f of walk(join(ROOT, 'src')).filter((p) => p.endsWith('.js'))) {
    const t = readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /\son[a-z]+=\\?["']/i, `${f} に on*= 属性がある`);
  }
});

test('connect-src は、サーバーURLが許す localhost・127.0.0.1・[::1]（http）をすべて含む', () => {
  const c = directive('connect-src');
  for (const origin of ['http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*']) {
    assert.ok(c.split(' ').includes(origin), `${origin} が無い`);
  }
});

test('style-src-attr は unsafe-inline だけ（style 属性は、どうしても要るものだけ）', () => {
  assert.match(csp, /style-src-attr 'unsafe-inline'/);
  assert.equal(directive('style-src'), "style-src 'self'");
});

test('web/_headers に frame-ancestors と nosniff などがある（Worker 配信の静的ファイル）', () => {
  const h = readFileSync(join(ROOT, 'web', '_headers'), 'utf8');
  assert.match(h, /^\/\*/m);
  assert.match(h, /X-Content-Type-Options: nosniff/);
  assert.match(h, /Referrer-Policy: no-referrer/);
  assert.match(h, /X-Frame-Options: DENY/);
  assert.match(h, /Content-Security-Policy: frame-ancestors 'none'/);
});
