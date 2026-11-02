// GitHub Actions の権限と、第三者のアクションの固定を確かめる（PR1）。
// 書き込み権限のトークンを PR のビルドに渡さないこと、外部のアクションを SHA に固定することを守る。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', '..', '.github', 'workflows');
const read = (name) => readFileSync(join(DIR, name), 'utf8');

// 改行は LF に正規化してから読む（Windows の checkout は CRLF になるため。PR1 の CI で失敗した）
const lines = (text) => text.replace(/\r\n/g, '\n').split('\n');

// jobs: より前の、ワークフロー直下の permissions ブロック（字下げされた行の並び）
function topPermissions(text) {
  const ls = lines(text);
  const jobsAt = ls.findIndex((l) => /^jobs:/.test(l));
  const head = jobsAt === -1 ? ls : ls.slice(0, jobsAt);
  const at = head.findIndex((l) => l === 'permissions:');
  if (at === -1) return null;
  const body = [];
  for (const l of head.slice(at + 1)) {
    if (l.trim() === '') continue;
    if (!/^[ \t]/.test(l)) break;
    body.push(l);
  }
  return body.join('\n');
}

// 1つのジョブ（"  名前:" の行から、次の字下げの少ない行まで）
function jobBlock(text, name) {
  const ls = lines(text);
  const at = ls.findIndex((l) => l === `  ${name}:`);
  if (at === -1) return null;
  const body = [];
  for (const l of ls.slice(at + 1)) {
    if (l.trim() !== '' && !/^ {4}/.test(l)) break;
    body.push(l);
  }
  return body.join('\n');
}

test('windows.yml: 先頭は contents: read、書き込みは別ジョブのみ', () => {
  const t = read('windows.yml');
  const top = topPermissions(t);
  assert.ok(top, 'ワークフロー直下に permissions が必要');
  assert.match(top, /contents:\s*read/);
  assert.doesNotMatch(top, /contents:\s*write/);

  const build = jobBlock(t, 'build');
  assert.ok(build, 'build ジョブがある');
  assert.doesNotMatch(build, /contents:\s*write/, 'build に書き込み権限を渡さない');
  assert.doesNotMatch(build, /GH_TOKEN/, 'build で GitHub のトークンを使わない');
  assert.match(build, /upload-artifact@/, 'exe は artifact で渡す');

  const release = jobBlock(t, 'release');
  assert.ok(release, 'release ジョブが別にある');
  assert.match(release, /needs:\s*build/);
  assert.match(release, /if:\s*startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.match(release, /permissions:\n\s+contents:\s*write/);
  assert.match(release, /download-artifact@/);
  assert.match(release, /runs-on:\s*ubuntu-latest/);
});

test('Windows の改行（CRLF）でも、権限とジョブを読める（CI の windows-latest で失敗した再発防止）', () => {
  const crlf = read('windows.yml').replace(/\n/g, '\r\n');
  assert.match(topPermissions(crlf), /contents:\s*read/);
  assert.match(jobBlock(crlf, 'release'), /contents:\s*write/);
  assert.match(topPermissions(read('ci.yml').replace(/\n/g, '\r\n')), /contents:\s*read/);
});

test('ci.yml: 先頭に permissions: contents: read', () => {
  const top = topPermissions(read('ci.yml'));
  assert.ok(top, 'ワークフロー直下に permissions が必要');
  assert.match(top, /contents:\s*read/);
});

test('第三者のアクション（anthropics/claude-code-action）はコミット SHA に固定', () => {
  const t = read('claude-code-review.yml');
  const uses = [...t.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  const third = uses.filter((u) => !u.startsWith('actions/'));
  assert.ok(third.length > 0);
  for (const u of third) {
    assert.match(u, /@[0-9a-f]{40}$/, `${u} は SHA に固定する`);
  }
});

test('Dependabot: github-actions と npm を週次で見る', () => {
  const t = readFileSync(join(import.meta.dirname, '..', '..', '.github', 'dependabot.yml'), 'utf8');
  assert.match(t, /package-ecosystem:\s*"?github-actions"?/);
  assert.match(t, /package-ecosystem:\s*"?npm"?/);
  assert.equal((t.match(/interval:\s*"?weekly"?/g) || []).length, 2);
});

test('全ワークフローが読める（ファイルがある）', () => {
  assert.ok(readdirSync(DIR).length >= 4);
});
