// エントリポイント: タブ切替・ヘッダー操作・保存/読込

import { getState, setState, onChange, onSaveStatus, initState, isReadOnly, undo, canUndo, undoLabel, onUndoChange } from './store.js';
import { toast, downloadBlob, safeFileName, fontsReady } from './io.js';
import { createState, parseState, serializeState, hasContent } from '../core/state.js';
import { renderSetup, setupSetupView } from './setupView.js';
import { renderTournament, setupTournamentView } from './tournamentView.js';
import { renderLeague, setupLeagueView } from './leagueView.js';
import { renderStandings, setupStandingsView } from './standingsView.js';
import { setupResultDialog } from './resultDialog.js';
import { setupCallScreen, refreshCallScreen } from './callScreen.js';
import { callViewParams, startCallWindow } from './callWindow.js';
import { setupCallNotify } from './callChannel.js';
import { renderComments, setupCommentsView } from './commentsView.js';
import { setupEditions } from './editions.js';
import { setupMenu } from './menu.js';
import { setupQrDialog } from './qrDialog.js';
import { setupExportMenus } from './exportMenu.js';
import { renderMyPanel, setupMyMatch } from './myMatch.js';
import { updateElapsed, setupElapsedTimer } from './startMatch.js';
import { eventTitle } from '../core/edition.js';
import { S, initShare, isSharing, isViewer, isAdmin, onShareChange, openShareDialog, setupShareDialog } from './share.js';

const TABS = { setup: renderSetup, tournament: renderTournament, league: renderLeague, standings: renderStandings, comments: renderComments };
const TAB_KEY = 'bukatsu-taikai:tab';
let activeTab = 'setup';

function render() {
  document.getElementById('print-title').textContent = eventTitle(getState());
  document.title = `${eventTitle(getState())} - 部内大会トーナメント`;
  TABS[activeTab]();
  refreshCallScreen();
  renderMyPanel();
  updateElapsed();
}

function showTab(name) {
  if (!TABS[name]) name = 'setup';
  if (isReadOnly() && name === 'setup') name = 'tournament'; // 閲覧中（共有・過去の回）は設定画面を使わない
  if (!isSharing() && name === 'comments') name = 'setup';
  activeTab = name;
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  for (const key of Object.keys(TABS)) document.getElementById(`panel-${key}`).hidden = key !== name;
  try { sessionStorage.setItem(TAB_KEY, name); } catch { /* 無視 */ }
  render();
  window.scrollTo(0, 0);
}

/** 共有の状態に合わせて、ヘッダーの表示・コメントタブ・閲覧専用の見た目を更新する */
function updateShareUi() {
  const chip = document.getElementById('share-chip');
  const sharing = isSharing();
  chip.hidden = !sharing;
  document.getElementById('tab-comments').hidden = !sharing;
  if (sharing) {
    const bad = S.status === 'error' || S.status === 'auth';
    chip.classList.toggle('bad', bad);
    const label = S.status === 'auth' ? '再ログインが必要' : S.status === 'error' ? '通信エラー' : S.status === 'sending' ? '送信中…' : isViewer() ? '閲覧中' : '共有中';
    chip.textContent = `${label} ${S.cfg.code}`;
    chip.title = S.status === 'error' || S.status === 'auth' ? S.message : '共有の設定を開く';
    const pending = isAdmin() ? S.reports.length : 0; // 運営には、承認待ちの結果の報告の数も知らせる
    document.getElementById('tab-comments').textContent = `コメント${S.comments.length ? ` (${S.comments.length})` : ''}${pending ? ` 報告${pending}` : ''}`;
  }
  renderMyPanel(); // 閲覧者かどうかで、最初から使えるか（運営はオフ）が変わる
  if (!sharing && activeTab === 'comments') showTab('setup');
  else if (isViewer() && activeTab === 'setup') showTab('tournament');
  else if (activeTab === 'comments') renderComments();
}

/** 「元に戻す」を実行する（ヘッダーのボタン・Ctrl+Z 共通） */
function doUndo() {
  if (!undo()) return;
  toast('元に戻しました');
}

function syncUndoButton() {
  const btn = document.getElementById('undo-btn');
  if (!btn) return;
  btn.disabled = !canUndo();
  // 何が戻るかを、メニューでは名前の下に、PC では title に出す（戻す前に分かるように）
  const label = canUndo() ? undoLabel() : '';
  const sub = document.getElementById('undo-sub');
  if (sub) sub.textContent = label ? `直前：${label}` : '';
  btn.title = label ? `直前の操作「${label}」を取り消します（Ctrl+Z）` : '直前の操作を取り消します（Ctrl+Z）';
}

/** Ctrl+Z（Mac は ⌘+Z）。入力欄・ダイアログが開いているときは、そちらの操作を優先する */
function onUndoKey(e) {
  if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
  const t = e.target;
  if (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"]')) return; // 入力中の文字の取り消しを優先
  if (document.querySelector('dialog[open]')) return;
  if (!canUndo()) return;
  e.preventDefault();
  doUndo();
}

/** 「新規」「読込」の確認に足す注意。過去の大会も一緒に置き換わること、共有中は公開している内容も置き換わること */
function replaceNotes(st, pastNote, shareNote) {
  const past = st.history?.length ?? 0;
  return (past ? `\n※過去の大会（${past}回分）も${pastNote}。` : '')
    + (isAdmin() ? `\n※共有中のため、公開している大会データも${shareNote}。` : '');
}

function saveFile() {
  const st = getState();
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(new Blob([serializeState(st)], { type: 'application/json' }), `${safeFileName(st.meta.title || '大会')}_${date}.json`);
  toast('大会データを保存しました');
}

async function loadFile(file) {
  if (isReadOnly()) return;
  const r = parseState(await file.text());
  if (!r.ok) { toast(`読み込めませんでした: ${r.error}`, { error: true }); return; }
  const cur = getState();
  if (hasContent(cur) && !confirm(`今の大会データを、読み込んだデータで置き換えますか？${replaceNotes(cur, '読み込んだ内容に置き換わります', '読み込んだ内容に置き換わります')}`)) return;
  setState(r.state);
  toast(`「${eventTitle(r.state)}」を読み込みました`);
}

function setupHeader() {
  setupMenu();
  setupQrDialog();
  setupExportMenus();
  const fileInput = document.getElementById('load-file');
  document.querySelector('.header-actions').addEventListener('click', (e) => {
    const act = e.target.closest('button[data-action]')?.dataset.action;
    if (act === 'share') openShareDialog();
    else if (act === 'new') {
      const cur = getState();
      if (hasContent(cur) && !confirm(`今の大会データを消して新しく始めますか？\n（必要なら先に「保存」でファイルに保存してください）${replaceNotes(cur, '消えます', '新しい内容に置き換わります')}`)) return;
      setState(createState());
      showTab('setup');
      toast('新しい大会を作成しました');
    } else if (act === 'save') saveFile();
    else if (act === 'load') fileInput.click();
    else if (act === 'print') window.print();
    else if (act === 'undo') doUndo();
  });
  document.addEventListener('keydown', onUndoKey);
  onUndoChange(syncUndoButton);
  syncUndoButton();
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (f) await loadFile(f);
  });
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) showTab(b.dataset.tab);
  });
  document.querySelector('main').addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) showTab(g.dataset.goto);
  });
  window.addEventListener('app:tab', (e) => showTab(e.detail));
  const status = document.getElementById('save-status');
  onSaveStatus(({ ok, at }) => {
    status.textContent = ok ? `自動保存 ${at.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}` : '自動保存できません';
    status.dataset.short = ok ? '保存済み' : '保存できません'; // スマホ幅では、この短い表記を出す
    status.title = ok ? 'このブラウザに自動保存しています' : 'ブラウザの設定で保存が無効です。「保存」でファイルに保存してください';
  });
}

function init() {
  const callWindow = callViewParams();
  if (callWindow) { startCallWindow(callWindow); return; } // 呼び出し画面だけの別ウィンドウ（読み取り専用。共有もしない）
  const restored = initState();
  setupHeader();
  setupSetupView();
  setupTournamentView();
  setupLeagueView();
  setupStandingsView();
  setupResultDialog();
  setupCallScreen();
  setupCallNotify();
  setupCommentsView();
  setupEditions();
  setupMyMatch();
  setupElapsedTimer();
  setupShareDialog();
  onChange(render);
  onShareChange(updateShareUi);
  let tab = 'setup';
  try { tab = sessionStorage.getItem(TAB_KEY) || 'setup'; } catch { /* 無視 */ }
  initShare();
  showTab(tab);
  updateShareUi();
  if (restored && !isReadOnly()) toast('前回の続きから再開しました');
}

// 半角英数字の幅が確定してから最初の描画をする（表の文字幅の計算が画面のフォントとずれないように）
fontsReady().then(init);
