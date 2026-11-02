// 試合の状態を示すバッジ（試合結果一覧など、状態を出す画面で共用する）。
// 色だけに頼らず、文字で状態を示す。見た目は web/style.css の .badge-*:
//   試合待ち＝青の塗り／進行中＝緑の塗り／終了＝灰の枠／対戦者未定＝点線の枠／不戦＝灰の文字だけ

import { h } from './io.js';
import { STATUS } from '../core/exportData.js';
import { ABSENT_MARK } from '../core/state.js';

/** バッジを出す状態（表に出さない 'empty' を除く） */
export const BADGE_STATUSES = ['ready', 'running', 'done', 'waiting', 'bye'];

/** 試合のバッジに使う状態。試合待ち（ready）で開始時刻があれば「進行中」 */
export const matchStatusKey = (m) => (m.status === 'ready' && m.startedAt ? 'running' : m.status);

/** @param {string} status 試合の状態（ready / running / done / waiting / bye） */
export function statusBadge(status) {
  if (!BADGE_STATUSES.includes(status)) return '';
  return `<span class="badge badge-${status}">${h(STATUS[status])}</span>`;
}

/** 順位表で、まだ勝ち残っている選手に出すバッジ（順位の欄） */
export function aliveBadge() {
  return '<span class="badge badge-alive">勝ち残り</span>';
}

/** 欠席の選手に出すバッジ（名前の後ろ。灰の枠） */
export function absentBadge() {
  return '<span class="badge badge-absent">欠席</span>';
}

/**
 * 表のセルの文字をエスケープして出す。出力用の名前が末尾に「（欠席）」を持つときは、その文字を灰の枠のバッジに替える
 * （CSV・PNG は文字のまま、画面の表だけバッジにする）。
 */
export function nameHtml(text) {
  const t = String(text ?? '');
  return t.endsWith(ABSENT_MARK) ? `${h(t.slice(0, -ABSENT_MARK.length))}${absentBadge()}` : h(t);
}

/** コメントの投稿者が運営なら「運営」の印（PR4・D63）。role が無い古い応答では何も出さない */
export function commentRoleBadge(c) {
  return c && c.role === 'admin' ? '<span class="badge badge-admin">運営</span>' : '';
}
