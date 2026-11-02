// 共有（運営が大会データを公開し、閲覧者が見る・コメントする）の通信・同期・ダイアログ
//
// 閲覧者はパスワード不要（閲覧リンク＝共有コードを知っていれば入れる）。運営だけが運営用パスワードを持つ。
// 運営: 保存のたびに大会データを送信（少し待ってまとめて）。閲覧者: 15秒ごとに更新を確認。
// 閲覧中は store を読み取り専用にし、この端末の自動保存データを上書きしない。

import { getState, setState, setReadOnly, setRemoteState, reloadLocal, onSaved } from './store.js';
import { toast, h } from './io.js';
import { createState, parseState } from '../core/state.js';
import { openQr } from './qrDialog.js';
import { normalizeBase, defaultBase, normalizeCode, viewerLink, codeFromHash, PASSWORD_MIN, decideJoin } from '../core/share.js';
import { fitForShare } from '../core/edition.js';

const KEY = 'bukatsu-taikai:share';
const NAME_KEY = 'bukatsu-taikai:comment-name';
const POLL_MS = 15000;
const PUSH_DELAY_MS = 1500;

/** 画面が読む共有の状態 */
export const S = {
  cfg: null, // { base, code, role, token, exp }
  status: 'off', // off | ok | sending | error | auth
  message: '',
  rev: -1,
  crev: -1,
  comments: [],
  reports: [], // 閲覧者からの結果の報告（承認待ち。運営の画面だけ受け取る）
  title: '',
  updatedAt: null, // サーバー側の最終更新（秒）
  keepUntil: null, // 共有ページが残る期限（秒。運営が最後に更新してから90日。サーバーが返す）
  lastPush: null,
};

let pollTimer = null;
let pushTimer = null;
let dirty = false;
let pushing = false;
const listeners = new Set();
const $ = (id) => document.getElementById(id);

export const onShareChange = (f) => listeners.add(f);

/** 閲覧中に受け取った大会データの表示方法。既定はそのまま表示。過去の回を見ている間は、画面を切り替えずに最新の内容だけ控える（editions.js が差し替える） */
let applyRemote = setRemoteState;
export function setRemoteStateHandler(fn) {
  applyRemote = fn;
}
const emit = () => listeners.forEach((f) => f());
export const isSharing = () => !!S.cfg;
export const isViewer = () => S.cfg?.role === 'viewer';
export const isAdmin = () => S.cfg?.role === 'admin';

export function getCommentName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}
export function setCommentName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* 無視 */ }
}

function saveCfg() {
  try {
    if (S.cfg) localStorage.setItem(KEY, JSON.stringify(S.cfg));
    else localStorage.removeItem(KEY);
  } catch { /* 無視 */ }
}

function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (c && typeof c.base === 'string' && typeof c.token === 'string' && normalizeCode(c.code) && ['admin', 'viewer'].includes(c.role)) return c;
  } catch { /* 無視 */ }
  return null;
}

// ---- 通信 ----

class ShareError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(base, method, path, { token, body } = {}) {
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ShareError(0, '共有サーバーに接続できませんでした。通信状況とサーバーURLを確認してください');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new ShareError(res.status, data?.error || `サーバーの応答が正しくありません（${res.status}）`);
  return data;
}

/** 閲覧者のトークンは期限（12時間）が来ても、パスワード不要なので自動で取り直す */
async function rejoinViewer() {
  const data = await request(S.cfg.base, 'POST', `/api/rooms/${S.cfg.code}/join`);
  S.cfg = { ...S.cfg, token: data.token, exp: data.expiresAt };
  saveCfg();
}

async function call(method, path, body) {
  const go = () => request(S.cfg.base, method, `/api/rooms/${S.cfg.code}${path}`, { token: S.cfg.token, body });
  try {
    return await go();
  } catch (e) {
    if (e.status === 401 && isViewer()) {
      await rejoinViewer();
      return go();
    }
    throw e;
  }
}

function setStatus(status, message = '') {
  S.status = status;
  S.message = message;
  emit();
}

// ---- 接続・切断 ----

function useSession(base, data, role) {
  S.cfg = { base, code: data.code, role, token: data.token, exp: data.expiresAt };
  S.rev = -1;
  S.crev = -1;
  S.comments = [];
  S.reports = [];
  S.title = '';
  S.updatedAt = null;
  S.keepUntil = null;
  saveCfg();
  if (role === 'viewer') enterViewer();
  setStatus('ok');
  startPolling();
}

function enterViewer() {
  setReadOnly(true);
  document.body.classList.add('viewer');
  setRemoteState(createState());
}

function leaveViewer() {
  setReadOnly(false);
  document.body.classList.remove('viewer');
  reloadLocal();
}

/** 運営として共有を始める。大会データをすぐ送信する */
async function startShare({ base, adminPassword }) {
  const data = await request(base, 'POST', '/api/rooms', { body: { adminPassword, title: getState().meta.title } });
  useSession(base, data, 'admin');
  await pushNow();
  return data.code;
}

function loginAdmin({ base, code, password }) {
  return request(base, 'POST', `/api/rooms/${code}/login`, { body: { password } });
}

async function joinViewer({ base, code }) {
  const data = await request(base, 'POST', `/api/rooms/${code}/join`);
  useSession(base, data, 'viewer');
  await pollOnce();
  window.dispatchEvent(new CustomEvent('app:tab', { detail: 'tournament' }));
}

async function joinAdmin(args) {
  const data = await loginAdmin(args);
  useSession(args.base, data, 'admin');
  const r = await call('GET', '/sync?rev=-1&crev=-1');
  S.rev = r.rev;
  S.crev = r.crev;
  S.comments = r.comments || [];
  S.reports = r.reports || [];
  const parsed = r.state ? parseState(r.state) : null;
  const decision = decideJoin(r.state, parsed);
  if (decision === 'blocked') {
    // 読めないデータを上書きしない。運営セッションを捨て（disconnect と同じ後始末）、理由を出す
    disconnect();
    toast('共有の大会データが、このアプリでは読めません。アプリを更新してから、もう一度お試しください');
    return;
  }
  if (decision === 'ask' && confirm('この共有に公開済みの大会データがあります。\n\nOK: 公開済みの内容をこの端末に読み込む\nキャンセル: この端末の内容で公開し直す')) {
    // 共有には過去の回を全部は載せないことがあるため、この端末の過去の回のほうが多ければそれを残す
    const mine = getState().history ?? [];
    setState({ ...parsed.state, history: mine.length >= parsed.state.history.length ? mine : parsed.state.history });
    toast('公開済みの大会データを読み込みました');
  } else {
    await pushNow();
  }
  emit();
}

function relogin(password) {
  return loginAdmin({ base: S.cfg.base, code: S.cfg.code, password }).then((data) => {
    S.cfg = { ...S.cfg, token: data.token, exp: data.expiresAt };
    saveCfg();
    setStatus('ok');
    startPolling();
    if (isAdmin()) pushNow();
  });
}

export function disconnect() {
  const wasViewer = isViewer();
  clearTimeout(pollTimer);
  clearTimeout(pushTimer);
  dirty = false;
  S.cfg = null;
  S.comments = [];
  S.reports = [];
  saveCfg();
  if (wasViewer) leaveViewer();
  setStatus('off');
}

async function closeShare() {
  if (!confirm('共有を終了します。サーバーに置いた大会データとコメントはすべて削除され、閲覧者は見られなくなります。\n（この端末の大会データは残ります）\n\nよろしいですか？')) return;
  await call('DELETE', '');
  disconnect();
  toast('共有を終了しました');
}

// ---- 運営: 送信 ----

export async function pushNow() {
  if (!isAdmin() || S.status === 'auth') return;
  clearTimeout(pushTimer);
  if (pushing) { dirty = true; return; }
  pushing = true;
  dirty = false;
  setStatus('sending');
  try {
    const r = await call('PUT', '/state', { state: fitForShare(getState()) });
    S.rev = r.rev;
    S.keepUntil = r.keepUntil ?? S.keepUntil;
    S.lastPush = new Date();
    setStatus('ok');
  } catch (e) {
    dirty = true;
    handleError(e, '大会データを送信できませんでした');
  } finally {
    pushing = false;
  }
  if (dirty && S.status === 'ok') schedulePush();
}

function schedulePush() {
  if (!isAdmin() || S.status === 'auth') return;
  dirty = true;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, PUSH_DELAY_MS);
}

// ---- 同期（コメント・閲覧者のデータ更新） ----

function handleError(e, prefix) {
  if (e.status === 401 && isAdmin()) {
    clearTimeout(pollTimer);
    setStatus('auth', e.message);
    toast('共有の認証が切れました。共有の画面でパスワードを入力してください', { error: true });
  } else if (e.status === 404) {
    const wasViewer = isViewer();
    disconnect();
    toast(wasViewer ? '共有は終了しました' : '共有が見つかりません（終了した可能性があります）', { error: true });
  } else {
    setStatus('error', e.status ? e.message : `${prefix}。${e.message}`);
  }
}

async function pollOnce() {
  if (!S.cfg || S.status === 'auth') return;
  try {
    const r = await call('GET', `/sync?rev=${S.rev}&crev=${S.crev}`);
    S.title = r.title;
    S.updatedAt = r.updatedAt;
    S.keepUntil = r.keepUntil ?? null;
    if (r.rev !== S.rev) {
      S.rev = r.rev;
      if (isViewer() && r.state) {
        const parsed = parseState(r.state);
        if (parsed.ok) applyRemote(parsed.state);
        else toast(`受信した大会データを読み込めませんでした: ${parsed.error}`, { error: true });
      }
    }
    if (r.comments) {
      S.comments = r.comments;
      S.reports = r.reports || [];
      S.crev = r.crev;
    }
    if (S.status !== 'sending') setStatus('ok');
    else emit();
    if (dirty && isAdmin()) schedulePush();
  } catch (e) {
    handleError(e, '共有サーバーから更新を取得できませんでした');
  }
}

function startPolling() {
  clearTimeout(pollTimer);
  const tick = async () => {
    if (!S.cfg) return;
    if (!document.hidden) await pollOnce();
    if (S.cfg && S.status !== 'auth') pollTimer = setTimeout(tick, POLL_MS);
  };
  pollTimer = setTimeout(tick, POLL_MS);
}

// ---- コメント ----

export async function postComment({ name, text, matchId }) {
  await call('POST', '/comments', { name, text, matchId: matchId || null });
  await pollOnce();
}

export async function deleteComment(id) {
  await call('DELETE', `/comments/${id}`);
  await pollOnce();
}

// ---- 結果の報告（閲覧者が送り、運営が承認する） ----

/** 試合結果を報告する。表には反映されず、運営が承認したときに反映される */
export async function postReport({ name, matchId, outcome, score1, score2, p1, p2 }) {
  await call('POST', '/reports', { name, matchId, outcome, score1, score2, p1, p2 });
  await pollOnce();
}

/** 報告を取り除く（承認したあと・却下）。運営のみ */
export async function deleteReport(id) {
  await call('DELETE', `/reports/${id}`);
  await pollOnce();
}

export { ShareError };

// ---- 共有ダイアログ ----

/** パスワードを「設定する」欄は普通のテキスト入力にする。type=password だと、ブラウザやパスワード管理ツールが自動入力・自動生成・保存を促して紛らわしいため */
const PLAIN_INPUT = 'type="text" autocomplete="off" autocapitalize="none" spellcheck="false" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other"';

function field(id, label, attrs = '') {
  return `<label class="sh-field"><span>${label}</span><input id="${id}" ${attrs}></label>`;
}

function statusLine() {
  if (S.status === 'sending') return '送信中…';
  if (S.status === 'error') return `<span class="bad">${h(S.message)}</span>`;
  if (S.status === 'auth') return `<span class="bad">${h(S.message || '認証が切れました')}</span>`;
  const t = (d) => d.toLocaleTimeString('ja-JP');
  if (isAdmin()) return S.lastPush ? `最終送信 ${t(S.lastPush)}（変更は自動で送信されます）` : '共有中';
  return S.updatedAt ? `運営の最終更新 ${t(new Date(S.updatedAt * 1000))}（自動で更新されます）` : '運営がまだ大会データを公開していません';
}

/** 共有ページが残る期間の案内。運営が最後に更新してから90日で自動的に消える（更新のたびに延びる） */
function keepText() {
  if (!S.keepUntil) return '';
  const d = new Date(S.keepUntil * 1000);
  return `この共有ページは <b>${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日</b> まで残ります（運営が最後に更新してから90日。更新のたびに延びます。過ぎると自動で消えます）。`;
}

function bodyHtml(prefill) {
  const base = prefill.base ?? defaultBase(location);
  const baseField = field('sh-base', '共有サーバーのURL', `value="${h(base)}" placeholder="https://tournament.○○.workers.dev" autocomplete="url" inputmode="url"`);
  if (S.cfg && S.status === 'auth') {
    return `<p class="bad">${h(S.message || '認証が切れました')}</p>
    <p>共有コード <b class="sh-code">${h(S.cfg.code)}</b> に入り直します。運営用パスワードを入力してください。</p>
    ${field('sh-pw', '運営用パスワード', 'type="password" autocomplete="current-password"')}
    <p class="sh-actions"><button type="button" class="primary" data-sh="relogin">入り直す</button> <button type="button" data-sh="disconnect">共有から切断</button></p>`;
  }
  if (isAdmin()) {
    const link = viewerLink(S.cfg.base, S.cfg.code);
    return `<p class="sh-state">${statusLine()}</p>
    <div class="sh-row"><span>共有コード</span><b class="sh-code">${h(S.cfg.code)}</b></div>
    <div class="sh-row"><span>閲覧リンク</span><input id="sh-link" readonly value="${h(link)}"><button type="button" data-sh="copy">コピー</button><button type="button" data-sh="qr">QRコード</button></div>
    <p class="hint sh-keep">${keepText()}</p>
    <p class="hint">閲覧者には、この<b>閲覧リンク</b>を伝えてください。リンクを知っている人は、パスワードなしで閲覧・コメントできます（リンクを知らない人は入れません）。個人情報は載せない運用にしてください。</p>
    <p class="sh-actions"><button type="button" class="primary" data-sh="push">今すぐ送信</button></p>
    <details class="sh-details"><summary>運営用パスワードを変更する</summary>
      <div class="sh-pwrow">${field('sh-newa', '新しい運営用パスワード（入力した文字がそのまま表示されます）', PLAIN_INPUT)}<button type="button" data-sh="pw-admin">変更</button></div>
    </details>
    <p class="sh-actions"><button type="button" data-sh="disconnect">切断（共有は残す）</button> <button type="button" class="danger" data-sh="close">共有を終了（サーバーのデータを削除）</button></p>`;
  }
  if (isViewer()) {
    return `<p class="sh-state">${statusLine()}</p>
    <div class="sh-row"><span>共有コード</span><b class="sh-code">${h(S.cfg.code)}</b></div>
    <p class="hint sh-keep">${keepText()}</p>
    <p class="hint">閲覧専用です。コメントタブからコメントを書けます。</p>
    <p class="sh-actions"><button type="button" data-sh="disconnect">閲覧をやめる</button></p>`;
  }
  return `<p class="hint">大会データをサーバーに公開し、スマホなどから見られるようにします。閲覧者はパスワード不要で、閲覧リンクを開くだけです（コメントも書けます）。共有サーバー（Cloudflare Worker）が必要です。設定は README の「共有機能」を参照してください。</p>
  ${baseField}
  <section class="sh-section"><h3>大会を共有する（運営）</h3>
    ${field('sh-apw', `運営用パスワード（あなた専用・${PASSWORD_MIN}文字以上。忘れると運営として入れません。入力した文字がそのまま表示されます）`, PLAIN_INPUT)}
    ${field('sh-apwc', '運営用パスワード（確認のためもう一度）', PLAIN_INPUT)}
    <button type="button" class="primary" data-sh="start">共有を始める</button></section>
  <section class="sh-section"><h3>共有を見る（閲覧）</h3>
    ${field('sh-code', '共有コード（閲覧リンクを開けば自動で入ります）', `value="${h(prefill.code || '')}" autocomplete="off" autocapitalize="none" spellcheck="false"`)}
    <button type="button" class="primary" data-sh="join">見る</button></section>
  <details class="sh-details"><summary>運営として再接続する（別の端末・認証切れ）</summary>
    ${field('sh-code2', '共有コード', 'autocomplete="off" autocapitalize="none" spellcheck="false"')}
    ${field('sh-apw2', '運営用パスワード', 'type="password" autocomplete="current-password"')}
    <button type="button" data-sh="admin">運営として接続</button></details>`;
}

let prefillCache = {};

export function renderShareDialog() {
  const dlg = $('share-dialog');
  if (!dlg.open) return;
  // 入力中の値を失わないよう、接続状態が変わらない更新（状態表示だけ）では本文を作り直さない
  const key = `${S.cfg ? S.cfg.role : 'off'}:${S.cfg?.code ?? ''}:${S.status === 'auth' ? 'auth' : ''}`;
  const body = $('share-body');
  if (body.dataset.key !== key) {
    body.innerHTML = bodyHtml(prefillCache);
    body.dataset.key = key;
  } else {
    const line = body.querySelector('.sh-state');
    if (line) line.innerHTML = statusLine();
    const keep = body.querySelector('.sh-keep');
    if (keep) keep.innerHTML = keepText();
  }
}

export function openShareDialog(prefill = {}) {
  prefillCache = prefill;
  const dlg = $('share-dialog');
  $('share-body').dataset.key = '';
  $('sh-error').textContent = '';
  if (!dlg.open) dlg.showModal();
  renderShareDialog();
}

function readBase() {
  const r = normalizeBase($('sh-base')?.value);
  if (!r.ok) throw new ShareError(0, r.error);
  if (!r.base) throw new ShareError(0, '共有サーバーのURLを入力してください');
  return r.base;
}

const val = (id) => $(id)?.value ?? '';

async function onAction(act, btn) {
  if (act === 'start') {
    const adminPassword = val('sh-apw');
    if (adminPassword.length < PASSWORD_MIN) throw new ShareError(0, `パスワードは${PASSWORD_MIN}文字以上で入力してください`);
    if (adminPassword !== val('sh-apwc')) throw new ShareError(0, '確認用のパスワードが一致しません');
    await startShare({ base: readBase(), adminPassword });
    toast('共有を始めました');
  } else if (act === 'join') {
    const code = normalizeCode(val('sh-code'));
    if (!code) throw new ShareError(0, '共有コードは8文字です。入力を確認してください');
    if (getState().players.length || getState().tournament || getState().league) {
      if (!confirm('共有を見ている間は、この端末の大会データは表示されません（閲覧をやめると元に戻ります。データは消えません）。\n続けますか？')) return;
    }
    await joinViewer({ base: readBase(), code });
  } else if (act === 'admin') {
    const code = normalizeCode(val('sh-code2'));
    if (!code) throw new ShareError(0, '共有コードは8文字です。入力を確認してください');
    await joinAdmin({ base: readBase(), code, password: val('sh-apw2') });
  } else if (act === 'relogin') {
    await relogin(val('sh-pw'));
  } else if (act === 'push') {
    await pushNow();
    if (S.status === 'error') throw new ShareError(0, S.message);
    toast('送信しました');
  } else if (act === 'copy') {
    const link = $('sh-link');
    link.select();
    try { await navigator.clipboard.writeText(link.value); toast('閲覧リンクをコピーしました'); } catch { toast('リンクを選択しました。コピーしてください'); }
  } else if (act === 'qr') {
    openQr($('sh-link').value);
  } else if (act === 'pw-admin') {
    const password = val('sh-newa');
    if (password.length < PASSWORD_MIN) throw new ShareError(0, `パスワードは${PASSWORD_MIN}文字以上で入力してください`);
    const r = await call('PUT', '/passwords', { password });
    S.cfg = { ...S.cfg, token: r.token, exp: r.expiresAt };
    saveCfg();
    $('sh-newa').value = '';
    toast('運営用パスワードを変更しました');
  } else if (act === 'disconnect') {
    disconnect();
    toast('共有から切断しました');
  } else if (act === 'close') {
    await closeShare();
  }
  btn.blur();
}

export function setupShareDialog() {
  const dlg = $('share-dialog');
  $('sh-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-sh]');
    if (!btn || btn.disabled) return;
    $('sh-error').textContent = '';
    btn.disabled = true;
    try {
      await onAction(btn.dataset.sh, btn);
    } catch (err) {
      $('sh-error').textContent = err.message;
    } finally {
      btn.disabled = false;
      // 接続状態が変わっていれば本文を作り直す
      renderShareDialog();
    }
  });
  onShareChange(renderShareDialog);
}

// ---- 起動時 ----

function hasLocalData() {
  const st = getState();
  return st.players.length > 0 || !!st.tournament || !!st.league;
}

/** 閲覧リンク（#v=共有コード）を開いたときの処理。ページを開いたときと、開いたままリンクを開き直したときの両方で呼ぶ */
function handleLinkHash() {
  const code = codeFromHash(location.hash);
  if (!code) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (S.cfg) {
    if (S.cfg.code !== code) toast('すでに別の共有に接続しています。先に「共有」から切断してください', { error: true });
    return;
  }
  const base = defaultBase(location);
  if (base && !hasLocalData()) {
    // 閲覧リンクを開いただけで入る。この端末に自分の大会データがあるときは、確認のためダイアログを出す
    joinViewer({ base, code }).catch((err) => {
      toast(err.message, { error: true });
      openShareDialog({ code });
    });
  } else {
    openShareDialog({ code });
  }
}

export function initShare() {
  onSaved(schedulePush);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.cfg) pollOnce(); });
  window.addEventListener('online', () => { if (S.cfg) pollOnce(); });
  window.addEventListener('hashchange', handleLinkHash);

  const saved = loadCfg();
  if (saved) {
    S.cfg = saved;
    if (isViewer()) enterViewer();
    if (isAdmin() && saved.exp * 1000 < Date.now()) {
      S.status = 'auth';
      S.message = '前回のログインの有効期限が切れました';
    } else {
      // 閲覧者は期限が切れていても、最初の通信で自動的に取り直す（パスワード不要）
      S.status = 'ok';
      startPolling();
      pollOnce();
    }
    emit();
  }
  // ダイアログの表示は初期描画のあとに行う
  setTimeout(handleLinkHash, 0);
}
