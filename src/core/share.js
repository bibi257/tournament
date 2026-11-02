// 共有機能の純粋ロジック（URL・コード・コメント対象の整形）。DOM に依存しない

import { resolveBracket, roundName } from './bracket.js';
import { resolveLeague } from './league.js';
import { playerName } from './state.js';

export const CODE_PATTERN = /^[a-hj-km-np-z2-9]{8}$/;
export const COMMENT_MAX = 200;
export const NAME_MAX = 20;
export const PASSWORD_MIN = 6;

/** 入力された共有コードを正規化（空白・ハイフン除去、小文字化）。不正なら null */
export function normalizeCode(input) {
  const code = String(input ?? '').replace(/[\s-]/g, '').toLowerCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/** サーバーURLを検査して origin だけにする。空文字は「未設定」 */
export function normalizeBase(input) {
  const s = String(input ?? '').trim();
  if (!s) return { ok: true, base: '' };
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return { ok: false, error: 'サーバーURLの形式が正しくありません' };
  }
  if (url.protocol === 'https:') return { ok: true, base: url.origin };
  // http は手元の確認用（localhost・127.0.0.1・[::1]）だけ。それ以外は平文でパスワードとトークンが流れる（D62）
  const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
  if (url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname)) return { ok: true, base: url.origin };
  return { ok: false, error: 'サーバーURLは https:// で始まるものを入力してください' };
}

/**
 * 運営ログインのあと、共有の既存データをどうするか（D62）。
 * 'push'：共有が空（この端末の内容を公開する）／'ask'：読める（読み込むか、公開し直すかを確認）／
 * 'blocked'：読めない（新しい版で保存された・破損。上書きせず、運営セッションを捨てる）
 */
export function decideJoin(serverState, parsed) {
  if (!serverState) return 'push';
  return parsed && parsed.ok ? 'ask' : 'blocked';
}

/** 同じサーバーで配信されているページ（workers.dev・手元の確認用）なら、そのオリジンを既定にする。GitHub Pages・file:// は空 */
export function defaultBase(loc) {
  if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return '';
  if (loc.hostname.endsWith('.github.io')) return '';
  return loc.origin;
}

export function viewerLink(base, code) {
  return `${base}/#v=${code}`;
}

/** URL の # 部分から共有コードを取り出す（#v=コード） */
export function codeFromHash(hash) {
  const m = /^#v=([A-Za-z0-9-]{8,12})$/.exec(hash || '');
  return m ? normalizeCode(m[1]) : null;
}

/** コメントの対象（試合）の一覧。結果入力が必要な試合だけ */
export function commentTargets(state) {
  const out = [];
  const label = (id) => (id === undefined ? '（未定）' : playerName(state, id) || '（未定）');
  if (state.tournament) {
    const res = resolveBracket(state.tournament, state.tables);
    for (const m of res.playable) {
      const round = m.isThirdPlace ? '3位決定戦' : roundName(m.round, res.roundCount);
      out.push({ id: m.id, group: 'トーナメント', label: `${round} No.${m.no}　${label(m.p1)} vs ${label(m.p2)}` });
    }
  }
  if (state.league) {
    const res = resolveLeague(state.league, state.tables);
    for (const m of res.matches) {
      out.push({ id: m.id, group: '総当たり', label: `${m.round}回戦 No.${m.no}　${label(m.p1)} vs ${label(m.p2)}` });
    }
  }
  return out;
}

/** コメントの対象の表示名。試合が見つからなければ「（その試合は表にありません）」 */
export function targetLabel(state, matchId) {
  if (!matchId) return '';
  return commentTargets(state).find((t) => t.id === matchId)?.label ?? '（その試合は表にありません）';
}

export function formatCommentTime(sec) {
  const d = new Date(sec * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
