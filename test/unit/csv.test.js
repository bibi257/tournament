import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCSV, parseCSV, escapeCell, decodeText, namesFromCSV } from '../../src/core/csv.js';

test('CSV: BOM付き・CRLF・エスケープ', () => {
  const s = toCSV([['名前', '備考'], ['山田 太郎', 'a,b'], ['"引用"', '改行\nあり']]);
  assert.ok(s.startsWith('﻿'));
  assert.equal(s, '﻿名前,備考\r\n山田 太郎,"a,b"\r\n"""引用""","改行\nあり"\r\n');
});

test('CSV: 数式になりうるセルを無害化、数値はそのまま', () => {
  assert.equal(escapeCell('=1+1'), "'=1+1");
  assert.equal(escapeCell('+81'), "'+81");
  assert.equal(escapeCell('@SUM'), "'@SUM");
  assert.equal(escapeCell('-abc'), "'-abc");
  assert.equal(escapeCell('-3'), '-3');
  assert.equal(escapeCell(3), '3');
  assert.equal(escapeCell(null), '');
});

test('CSV: 解析（引用符・改行・CRLF・BOM）と往復', () => {
  const rows = [['a', 'b,c', 'd"e'], ['日本語', '', '複数\n行']];
  assert.deepEqual(parseCSV(toCSV(rows)), rows);
  assert.deepEqual(parseCSV('x,y\ny,z'), [['x', 'y'], ['y', 'z']]);
  assert.deepEqual(parseCSV(''), []);
});

test('文字コード: UTF-8 と Shift_JIS を判別', () => {
  const utf8 = new TextEncoder().encode('﻿名前\n山田');
  assert.equal(decodeText(utf8), '名前\n山田');
  // 「山田」の Shift_JIS: 8E 52 93 63
  const sjis = new Uint8Array([0x8e, 0x52, 0x93, 0x63]);
  assert.equal(decodeText(sjis), '山田');
});

test('名簿取込: 見出しの検出と列選択、空行除去', () => {
  assert.deepEqual(namesFromCSV('名前\n山田\n\n佐藤\n'), ['山田', '佐藤']);
  assert.deepEqual(namesFromCSV('学年,氏名\n1,山田\n2, 佐藤 \n'), ['山田', '佐藤']);
  assert.deepEqual(namesFromCSV('山田,1年\n佐藤,2年'), ['山田', '佐藤']);
  assert.deepEqual(namesFromCSV('Name\r\nAlice\r\nBob'), ['Alice', 'Bob']);
  assert.deepEqual(namesFromCSV(''), []);
});

test('CSV: 「3-1」の形のスコアは、Excel が日付に変えないよう ="3-1" の形で出す', () => {
  assert.equal(escapeCell('3-1'), '"=""3-1"""');
  assert.equal(escapeCell('11-9'), '"=""11-9"""');
  // スコアでないものは変えない（負の数・日付・記号つきの成績）
  assert.equal(escapeCell('-3'), '-3');
  assert.equal(escapeCell('2026-10-23'), '2026-10-23');
  assert.equal(escapeCell('○ 3-1'), '○ 3-1');
  assert.equal(escapeCell('不戦勝'), '不戦勝');
  // 読み戻すと、式の形（="3-1"）の1セルになる（行・列はずれない）
  assert.deepEqual(parseCSV(toCSV([['山田', '3-1', '佐藤']], { bom: false })), [['山田', '="3-1"', '佐藤']]);
});

test('CSV: セルの途中の引用符は文字として読む（後ろの行を1つのセルに飲み込まない）', () => {
  assert.deepEqual(parseCSV('a"b,c\r\nd,e\r\n'), [['a"b', 'c'], ['d', 'e']]);
  assert.deepEqual(namesFromCSV('山"田,1年\n佐藤,2年\n鈴木,3年\n'), ['山"田', '佐藤', '鈴木']);
  // セルの先頭（前に空白だけ）の引用符は、これまでどおり囲みとして読む
  assert.deepEqual(parseCSV(' "a,b",c'), [['a,b', 'c']]);
  assert.deepEqual(parseCSV('"x""y",z'), [['x"y', 'z']]);
});

/** 文字列を UTF-16（BOM 付き）のバイト列にする */
function utf16(s, littleEndian) {
  const b = new Uint8Array(2 + s.length * 2);
  const v = new DataView(b.buffer);
  v.setUint16(0, 0xfeff, littleEndian);
  for (let i = 0; i < s.length; i++) v.setUint16(2 + i * 2, s.charCodeAt(i), littleEndian);
  return b;
}

test('文字コード: UTF-16（Excel の「Unicode テキスト」）を BOM で判別する', () => {
  assert.equal(decodeText(utf16('名前\r\n山田', true)), '名前\r\n山田');
  assert.equal(decodeText(utf16('名前\r\n山田', false)), '名前\r\n山田');
  assert.deepEqual(namesFromCSV(decodeText(utf16('山田\r\n佐藤\r\n', true))), ['山田', '佐藤']);
});

test('名簿取込: タブ区切りは、見出しがあるときだけ列に分ける', () => {
  assert.deepEqual(namesFromCSV('学年\t名前\n1年\t山田\n2年\t佐藤'), ['山田', '佐藤']);
  assert.deepEqual(namesFromCSV(decodeText(utf16('名前\t学年\r\n山田\t1年\r\n', true))), ['山田']);
  // 見出しが無いときは、これまでどおり1行を1つの名前として読む（タブは取込のとき空白になる）
  assert.deepEqual(namesFromCSV('山田\t太郎\n佐藤\t花子'), ['山田\t太郎', '佐藤\t花子']);
  // カンマ区切りの見出しは、これまでどおり
  assert.deepEqual(namesFromCSV('学年,氏名\n1,山田'), ['山田']);
});

test('CSV: 終わりまで閉じない囲みの引用符は、文字として読み直す（後ろの行を飲み込まない）', () => {
  assert.deepEqual(parseCSV('"山田,1年\n佐藤,2年\n鈴木,3年\n'), [['"山田', '1年'], ['佐藤', '2年'], ['鈴木', '3年']]);
  assert.deepEqual(namesFromCSV('"山田,1年\n佐藤,2年\n鈴木,3年\n'), ['"山田', '佐藤', '鈴木']);
  // 途中の行の、閉じない囲み
  assert.deepEqual(namesFromCSV('山田\n"佐藤\n鈴木'), ['山田', '"佐藤', '鈴木']);
  // 閉じない囲みが3つあると、前の2つは対（1つの囲み）になり、最後の1つだけが文字になる
  assert.deepEqual(parseCSV('"a\n"b\n"c,d'), [['a\nb'], ['"c', 'd']]);
  // 閉じた囲みは、これまでどおり（改行を含むセル）
  assert.deepEqual(parseCSV('"a\nb",c\nd,e'), [['a\nb', 'c'], ['d', 'e']]);
});
