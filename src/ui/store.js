// 大会データの保持と自動保存（localStorage）

import { createState, parseState, serializeState } from '../core/state.js';
import { createUndo, recordChange, popUndo, undoLabel as historyUndoLabel, canUndo as historyCanUndo } from '../core/undo.js';
import { describeChange } from '../core/undoLabel.js';

const KEY = 'bukatsu-taikai:state';
export const STORAGE_KEY = KEY; // 別ウィンドウ（呼び出し画面）が、保存の変更を見分けるため
let state = null;
const listeners = new Set();
let statusCb = () => {};
let readOnly = false;
let localBackup = null; // 閲覧を始める前の自分の大会データ（自動保存が使えない環境でも閲覧後に戻すため）
const savedListeners = new Set();
let undoHistory = createUndo(); // 「元に戻す」の履歴（再読み込みで消える）
const undoListeners = new Set();

export function getState() {
  return state;
}

/**
 * 状態を置き換える。
 * @param {object} next
 * @param {{render?:boolean, merge?:boolean}} opts
 *   render:false なら画面を再描画しない（入力中のフォーカスを保つため）。
 *   merge:true は入力欄の連続した入力で、「元に戻す」では1回の操作にまとめる。
 */
export function setState(next, { render = true, merge = false } = {}) {
  if (readOnly) return; // 閲覧専用（共有を見ている間）は、操作で内容を変えない
  const prev = state;
  state = { ...next, meta: { ...next.meta, updatedAt: new Date().toISOString() } };
  setHistory(recordChange(undoHistory, prev, state, { merge, label: prev ? describeChange(prev, state) : '' }));
  persist();
  if (render) listeners.forEach((f) => f());
}

function setHistory(next) {
  if (next === undoHistory) return;
  const could = historyCanUndo(undoHistory);
  const label = historyUndoLabel(undoHistory);
  undoHistory = next;
  if (could !== historyCanUndo(undoHistory) || label !== historyUndoLabel(undoHistory)) undoListeners.forEach((f) => f());
}

/** 元に戻せる操作があるか（閲覧専用のときは戻せない） */
export function canUndo() {
  return !readOnly && historyCanUndo(undoHistory);
}

/** 今「元に戻す」を押すと戻る操作の名前（「結果の保存（No.3）」など。戻せないときは空） */
export function undoLabel() {
  return readOnly ? '' : historyUndoLabel(undoHistory);
}

/** 戻せるかどうか・戻る操作の名前が変わったときに呼ばれる（ヘッダーのボタンの状態用） */
export function onUndoChange(f) {
  undoListeners.add(f);
}

/**
 * 直前の操作を1つ戻す。戻した内容は、今の保存・共有の送信と同じ仕組みで保存・送信する。
 * @returns {boolean} 戻したか
 */
export function undo() {
  if (readOnly) return false;
  const r = popUndo(undoHistory);
  if (!r) return false;
  state = { ...r.state, meta: { ...r.state.meta, updatedAt: new Date().toISOString() } };
  setHistory(r.history);
  persist();
  listeners.forEach((f) => f());
  return true;
}

function clearUndo() {
  setHistory(createUndo());
}

export function onChange(f) {
  listeners.add(f);
}

/** 保存のたびに呼ばれる（共有の自動送信用。render:false の入力でも呼ばれる） */
export function onSaved(f) {
  savedListeners.add(f);
}

export function isReadOnly() {
  return readOnly;
}

export function setReadOnly(flag) {
  if (flag && !readOnly) localBackup = state;
  readOnly = flag;
  clearUndo(); // 閲覧を始める・やめるときは、履歴を引き継がない（別の大会データになるため）
}

/** 閲覧中に受け取った大会データを表示する。この端末の自動保存は上書きしない */
export function setRemoteState(next) {
  state = next;
  listeners.forEach((f) => f());
}

/**
 * 閲覧をやめたとき、自分の大会データへ戻す。
 * 自動保存から読み直す（別のタブで保存された新しい内容を、閲覧を始めたときの古い複製で上書きしないため）。
 * 自動保存が使えないときだけ、閲覧を始める前の複製を使う。
 */
export function reloadLocal() {
  const backup = localBackup;
  localBackup = null;
  const restored = initState();
  if (!restored && backup) state = backup;
  clearUndo();
  listeners.forEach((f) => f());
}

/**
 * 別のタブ・ウィンドウで保存された内容を、この画面に取り込む。
 * 同じブラウザで2つ開いているとき、古い内容のままの画面で操作すると、もう片方の変更を上書きして消してしまうため。
 * 閲覧専用のあいだ（共有・過去の大会を見ている）は取り込まない（戻るときに reloadLocal が自動保存から読み直す）。
 * 取り込んでも自動保存はし直さない（保存した側の画面が書いた内容を、書き直さない）。共有への送信は呼び出し側が予約する
 * （保存した側の画面が運営のセッションを持たないことがあるため。main.js）。「元に戻す」の履歴は、別の内容になるので引き継がない。
 * @param {string|null} raw 自動保存の中身（storage イベントの newValue）
 * @returns {boolean} 取り込んだか
 */
export function adoptSaved(raw) {
  if (readOnly || typeof raw !== 'string') return false;
  const r = parseState(raw);
  if (!r.ok) return false;
  state = r.state;
  clearUndo();
  listeners.forEach((f) => f());
  return true;
}

export function onSaveStatus(cb) {
  statusCb = cb;
}

function persist() {
  try {
    localStorage.setItem(KEY, serializeState(state));
    statusCb({ ok: true, at: new Date() });
  } catch {
    statusCb({ ok: false });
  }
  savedListeners.forEach((f) => f());
}

/** 自動保存から復元。なければ新規 */
export function initState() {
  let restored = false;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const r = parseState(raw);
      if (r.ok) { state = r.state; restored = true; }
    }
  } catch {
    // localStorage が使えない環境（プライベートモード等）
  }
  if (!state) state = createState();
  return restored;
}
