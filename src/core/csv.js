// CSV の生成・解析

const BOM = '﻿';

/** 数式として解釈されうるセルは先頭に ' を付ける（CSVインジェクション対策） */
function guardFormula(s) {
  if (/^[=+@\t\r]/.test(s)) return `'${s}`;
  if (/^-/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) return `'${s}`;
  return s;
}

/** 「3-1」の形のセル（スコア）。Excel は CSV を開くとき、これを日付（3月1日）に変えてしまう */
const DATE_LIKE = /^\d+-\d+$/;

export function escapeCell(v) {
  if (v === null || v === undefined) return '';
  const raw = String(v);
  // スコアは ="3-1" の形にして、Excel でも文字のまま表示させる（中身は数字と - だけなので、式として安全）
  const s = DATE_LIKE.test(raw) ? `="${raw}"` : guardFormula(raw);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 2次元配列を CSV 文字列にする（BOM 付き・CRLF） */
export function toCSV(rows, { bom = true } = {}) {
  return (bom ? BOM : '') + rows.map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * RFC 4180 形式の CSV を解析する。区切りは既定でカンマ（タブ区切りのテキストは delimiter に '\t'）。
 * 引用符（"）は、セルの先頭にあるときだけ囲みの始まりとみなす。途中の " は、そのままの文字として読む
 * （途中の " を囲みの始まりにすると、閉じる " が無いとき、後ろの行がすべて1つのセルに入ってしまう）。
 */
export function parseCSV(text, delimiter = ',') {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += c;
    } else if (c === '"' && cell.trim() === '') {
      inQuotes = true;
      cell = '';
    } else if (c === delimiter) {
      row.push(cell); cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * バイト列を文字列にする。先頭に UTF-16 の印（BOM）があれば UTF-16（Excel の「Unicode テキスト」）。
 * それ以外は UTF-8 として読み、不正なら Shift_JIS とみなす。
 */
export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

const NAME_HEADERS = ['名前', '氏名', '選手名', '参加者', '参加者名', 'name', 'player'];

/**
 * 名簿 CSV（または1行1名のテキスト）から名前の一覧を取り出す。
 * 1行目に「名前」「氏名」などの見出しがあれば、その列を使い見出し行は除く。なければ1列目。
 * 1行目がタブ区切りの見出し（「名前」などを含む）なら、タブ区切りとして読む（Excel のセルの貼り付け・「Unicode テキスト」）。
 * 見出しの無いタブ入りの行は、これまでどおり1つの名前として読む（「姓 タブ 名」を切らないため）。
 */
export function namesFromCSV(text) {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const tabHead = first.split('\t').map((c) => c.trim().toLowerCase());
  const delimiter = !first.includes(',') && tabHead.length > 1 && tabHead.some((c) => NAME_HEADERS.includes(c)) ? '\t' : ',';
  const rows = parseCSV(text, delimiter).filter((r) => r.some((c) => c.trim() !== ''));
  if (!rows.length) return [];
  let col = 0;
  const head = rows[0].map((c) => c.trim().toLowerCase());
  const idx = head.findIndex((c) => NAME_HEADERS.includes(c));
  if (idx >= 0) { col = idx; rows.shift(); }
  return rows.map((r) => (r[col] ?? '').trim()).filter((s) => s !== '');
}
