// 回（第1回・第2回…）の画面。次の回を始める・過去の回を見る（読み取り専用）・過去の回を削除する
//
// 過去の回を見ている間は、共有の閲覧と同じ読み取り専用の仕組みを使う（既存の表・結果・順位表・CSV/PNG 出力がそのまま使える）。
// 見ている間は自動保存しない。やめると、見る前の自分の大会データ（現在の回）へ戻る。
// 共有の閲覧者も、運営が公開した過去の回を見られる（見ている間に届いた最新の内容は控えておき、戻ったときに表示する）。

import { getState, setState, setReadOnly, setRemoteState, reloadLocal } from './store.js';
import { h, toast } from './io.js';
import { isAdmin, isViewer, onShareChange, setRemoteStateHandler } from './share.js';
import {
  currentEdition, startNextEdition, deleteEdition, editionState, editionSummary,
} from '../core/edition.js';
import { resolveBracket, tournamentProgress } from '../core/bracket.js';
import { resolveLeague, leagueProgress } from '../core/league.js';
import { formatEventDate } from '../core/schedule.js';

let real = null; // 過去の回を見ている間の、現在の回を含む大会データ（自分のデータ。共有の閲覧者なら、最新に届いた公開内容）
let viewing = null; // 見ている過去の回の番号
let asViewer = false; // 共有の閲覧者として見ているか

export const isViewingEdition = () => viewing !== null;

/** まだ終わっていない試合の説明（次の回を始める前の確認に出す） */
function unfinishedNotes(st) {
  const notes = [];
  if (st.tournament) {
    const p = tournamentProgress(resolveBracket(st.tournament, st.tables));
    if (p.done < p.total) notes.push(`トーナメントにあと${p.total - p.done}試合`);
  }
  if (st.league) {
    const p = leagueProgress(resolveLeague(st.league, st.tables));
    if (p.done < p.total) notes.push(`総当たりにあと${p.total - p.done}試合`);
  }
  return notes;
}

/** トーナメント・総当たりが終わったときに出す「次の回を始める」ボタン */
export function nextEditionButton() {
  return `<button type="button" class="owner-only" data-edition="next">第${currentEdition(getState()) + 1}回大会を始める</button>`;
}

let editionsOpen = false; // 過去の大会がないときの折りたたみを、画面を作り直しても保つ

/** 参加者・設定タブの「回」のカード。過去の大会がまだないときは折りたたんで、見出しだけ見せる */
export function editionsCardHtml(st) {
  const n = currentEdition(st);
  const canStart = !!(st.tournament || st.league);
  const past = [...(st.history ?? [])].reverse();
  const head = `大会の回数 <span class="muted">今は第${n}回大会</span>`;
  const body = `
    <p class="hint">同じ参加者・卓・設定のまま、次の大会（第${n + 1}回大会）を始められます。今の大会の表と結果は「過去の大会」に残り、あとから見たり、CSV・PNG で出力したりできます。</p>
    <p><button type="button" class="primary" data-edition="next" ${canStart ? '' : 'disabled'}>第${n + 1}回大会を始める</button>
      ${canStart ? '' : '<span class="hint">表を作成すると始められます</span>'}</p>
    ${past.length ? `<div class="table-wrap"><table class="data editions">
      <thead><tr><th>過去の大会</th><th>開催日時</th><th>結果</th><th>操作</th></tr></thead>
      <tbody>${past.map((e) => `<tr>
        <td>第${e.edition}回大会</td><td>${h(formatEventDate(e.date, e.time) || '－')}</td><td>${h(editionSummary(e))}</td>
        <td class="ops"><button type="button" class="small" data-edition-view="${e.edition}">見る</button>
          <button type="button" class="small danger" data-edition-del="${e.edition}">削除</button></td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted">過去の大会はまだありません。</p>'}`;
  if (past.length) return `<div class="card" id="editions-card"><h2>${head}</h2>${body}</div>`;
  return `<details class="card editions-fold" id="editions-card" ${editionsOpen ? 'open' : ''}><summary><h2>${head}</h2></summary>${body}</details>`;
}

/** 画面を作り直す直前に呼び、いま開いているかを覚える（toggle イベントは遅れて届くので、使わず今の状態を読む） */
export function keepEditionsFold() {
  const el = document.getElementById('editions-card');
  if (el instanceof HTMLDetailsElement) editionsOpen = el.open;
}

/** 順位表タブの、「上位N人で次の回を始める」欄（総当たりの順位表の下に出す。運営のみ） */
export function qualifyHtml(st) {
  const n = currentEdition(st);
  const alive = new Set(st.players.map((p) => p.id));
  const max = st.league.playerIds.filter((id) => alive.has(id)).length;
  if (max < 2) return '';
  return `<div class="qualify owner-only">
    <label>上位 <input type="number" id="qualify-count" class="field-w-5" min="2" max="${max}" value="${Math.min(4, max)}"> 人</label>
    <button type="button" data-edition="qualify">この人たちで第${n + 1}回大会を始める</button>
    <p class="hint">予選リーグのあとに決勝トーナメントを行うときなどに使います。上位の選手だけを、順位順の名簿にして次の大会を始めます（今の大会の記録は「過去の大会」に残ります）。</p>
  </div>`;
}

/** 次の回を始める。topCount を指定すると、総当たりの順位表の上位 topCount 人だけを引き継ぐ */
function nextEdition(topCount) {
  const st = getState();
  const r = startNextEdition(st, topCount === undefined ? {} : { topCount });
  if (!r.ok) { toast(r.error, { error: true }); return; }
  const n = currentEdition(st);
  const notes = unfinishedNotes(st);
  const carry = topCount === undefined
    ? '参加者・卓・設定はそのまま引き継ぎます。'
    : `総当たりの順位表の上位${topCount}人（${r.state.players.map((p) => p.name).join('、')}）を、順位順の名簿として引き継ぎます。卓・設定はそのまま引き継ぎます。` +
      `${r.tie ? `\n※${r.tie.rank}位が${r.tie.total}人いて、人数の境目に同順位の選手がいます。名簿の並びで選んでいるので、必要なら始めたあとに名簿で入れ替えてください。` : ''}`;
  const msg = `第${n}回大会の表と結果を「過去の大会」に残して、第${n + 1}回大会を始めます。\n${carry}` +
    `${notes.length ? `\n\n※まだ終わっていない試合があります（${notes.join('、')}）。順位は途中経過です。` : ''}` +
    `${isAdmin() ? `\n※共有中のため、閲覧者の画面も新しい大会（第${n + 1}回大会）の内容に変わります。` : ''}\n\nよろしいですか？`;
  if (!confirm(msg)) return;
  setState(r.state);
  toast(`第${n + 1}回大会を始めました。参加者を確認して、表を作成してください`);
  window.dispatchEvent(new CustomEvent('app:tab', { detail: 'setup' }));
}

function removeEdition(n) {
  if (!confirm(`第${n}回大会の記録を削除します。元に戻せません（必要なら先に「保存」でファイルに残してください）。\n\nよろしいですか？`)) return;
  setState(deleteEdition(getState(), n));
  toast(`第${n}回大会の記録を削除しました`);
}

function renderBanner() {
  const el = document.getElementById('edition-banner');
  const numbers = (list) => list.map((e) => e.edition);
  if (viewing === null) {
    // 共有の閲覧者には、公開された過去の回があるときだけ「過去の回を見る」を出す（運営は「回」のカードから見る）
    const past = isViewer() ? getState().history ?? [] : [];
    if (!past.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `<b>過去の大会の結果も見られます</b>
      <label>大会を選ぶ <select id="eb-select-past"><option value="">選んでください</option>${numbers(past).reverse().map((n) => `<option value="${n}">第${n}回大会</option>`).join('')}</select></label>`;
    return;
  }
  const cur = currentEdition(real);
  const options = numbers(real.history).map((n) => `<option value="${n}" ${n === viewing ? 'selected' : ''}>第${n}回大会</option>`).join('');
  el.hidden = false;
  el.innerHTML = `<b>第${viewing}回大会の記録を見ています</b>（閲覧専用です。変更はできません）
    <label>他の大会 <select id="eb-select">${options}<option value="current">第${cur}回大会（今の大会）</option></select></label>
    <button type="button" class="primary" data-edition="back">今の大会（第${cur}回大会）に戻る</button>`;
}

function viewEdition(n) {
  const src = viewing === null ? getState() : real;
  const view = editionState(src, n);
  if (!view) return;
  if (viewing === null) {
    real = src;
    asViewer = isViewer();
    if (!asViewer) setReadOnly(true); // 共有の閲覧者は、すでに読み取り専用
  }
  viewing = n;
  document.body.classList.add('viewer', 'archive-view');
  window.dispatchEvent(new CustomEvent('app:tab', { detail: view.tournament ? 'tournament' : view.league ? 'league' : 'standings' }));
  setRemoteState(view);
  renderBanner();
}

export function leaveEdition() {
  if (viewing === null) return;
  const latest = real;
  viewing = null;
  real = null;
  document.body.classList.remove('archive-view');
  if (asViewer) {
    // 共有の閲覧者: 見ている間に届いた最新の公開内容に戻る
    if (isViewer()) setRemoteState(latest);
    asViewer = false;
    renderBanner();
    window.dispatchEvent(new CustomEvent('app:tab', { detail: 'tournament' }));
    return;
  }
  document.body.classList.remove('viewer');
  setReadOnly(false);
  reloadLocal();
  renderBanner();
  window.dispatchEvent(new CustomEvent('app:tab', { detail: 'setup' }));
}

/** 共有から届いた最新の内容。過去の回を見ている間は画面を変えず、戻ったときに表示する */
function onRemote(next) {
  if (viewing === null) { setRemoteState(next); renderBanner(); return; }
  real = next;
  if (!next.history.some((e) => e.edition === viewing)) {
    // 見ていた回が、運営によって削除された
    leaveEdition();
    toast('見ていた回は、運営が削除したため閉じました');
    return;
  }
  renderBanner();
}

export function setupEditions() {
  setRemoteStateHandler(onRemote);
  // 閲覧をやめた・共有が終わったときに、バナーと見ていた回の状態を片付ける
  onShareChange(() => {
    if (viewing !== null && asViewer && !isViewer()) {
      viewing = null;
      real = null;
      asViewer = false;
      document.body.classList.remove('archive-view');
    }
    renderBanner();
  });
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const act = t.closest('[data-edition]')?.dataset.edition;
    if (act === 'next') nextEdition();
    else if (act === 'qualify') {
      const raw = document.getElementById('qualify-count')?.value.trim() ?? '';
      nextEdition(/^\d+$/.test(raw) ? Number(raw) : NaN);
    }
    else if (act === 'back') leaveEdition();
    const v = t.closest('[data-edition-view]');
    if (v) viewEdition(Number(v.dataset.editionView));
    const d = t.closest('[data-edition-del]');
    if (d) removeEdition(Number(d.dataset.editionDel));
  });
  document.getElementById('edition-banner').addEventListener('change', (e) => {
    if (e.target.id === 'eb-select-past') {
      if (e.target.value) viewEdition(Number(e.target.value));
    } else if (e.target.id === 'eb-select') {
      if (e.target.value === 'current') leaveEdition();
      else viewEdition(Number(e.target.value));
    }
  });
}
