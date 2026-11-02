// GitHub Actions の権限と、第三者のアクションの固定を確かめる（PR1）。
// 書き込み権限のトークンを PR のビルドに渡さないこと、外部のアクションを SHA に固定することを守る。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', '..', '.github', 'workflows');
const read = (name) => readFileSync(join(DIR, name), 'utf8');

// jobs: より前の、ワークフロー直下の permissions ブロック
function topPermissions(text) {
  const head = text.split(/^jobs:/m)[0];
  const m = head.match(/^permissions:\n((?:[ \t]+.*\n?)*)/m);
  return m ? m[1] : null;
}

// 1つのジョブ（ジョブ名から、次のジョブ名までの範囲）
function jobBlock(text, name) {
  const re = new RegExp(`^  ${name}:\\n((?:(?:    .*|\\s*)\\n?)*)`, 'm');
  const m = text.match(re);
  return m ? m[1] : null;
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
