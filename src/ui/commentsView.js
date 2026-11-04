// コメントタブ（共有中だけ表示）。フォームは一度だけ作り、一覧だけを更新する（入力中の文章を消さないため）

import { getState } from './store.js';
import { h, toast } from './io.js';
import {
  S, isAdmin, isSharing, postComment, deleteComment, getCommentName, setCommentName,
} from './share.js';
import { renderReports, setupReportView } from './reportView.js';
import { commentRoleBadge } from './badge.js';
import { commentTargets, targetLabel, formatCommentTime, COMMENT_MAX, NAME_MAX } from '../core/share.js';

const panel = () => document.getElementById('panel-comments');

function formHtml() {
  return `<div id="report-area"></div>
  <div class="card">
    <h2>コメント</h2>
    <form id="comment-form" class="comment-form" novalidate>
      <div class="cf-row">
        <label class="sh-field"><span>名前（空欄なら「名無し」）</span><input id="cf-name" maxlength="${NAME_MAX}" autocomplete="nickname" value="${h(getCommentName())}"></label>
        <label class="sh-field"><span>対象</span><select id="cf-target"></select></label>
      </div>
      <label class="sh-field"><span>コメント（${COMMENT_MAX}文字まで）</span><textarea id="cf-text" rows="3" maxlength="${COMMENT_MAX}"></textarea></label>
      <div class="cf-foot"><span class="hint" id="cf-count">0 / ${COMMENT_MAX}</span><span class="error" id="cf-error" role="alert"></span>
        <button type="submit" class="primary">投稿</button></div>
    </form>
  </div>
  <div class="card"><h2>みんなのコメント <span class="hint" id="cl-count"></span></h2><ul class="comment-list" id="comment-list"></ul></div>`;
}

function updateTargets() {
  const sel = document.getElementById('cf-target');
  const prev = sel.value;
  const groups = new Map();
  for (const t of commentTargets(getState())) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push(t);
  }
  sel.innerHTML = '<option value="">大会全体へ</option>' + [...groups].map(([g, list]) =>
    `<optgroup label="${h(g)}">${list.map((t) => `<option value="${h(t.id)}">${h(t.label)}</option>`).join('')}</optgroup>`).join('');
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function updateList() {
  const st = getState();
  const admin = isAdmin();
  const list = [...S.comments].reverse();
  document.getElementById('cl-count').textContent = `${list.length}件`;
  document.getElementById('comment-list').innerHTML = list.length
    ? list.map((c) => `<li class="comment" data-id="${h(c.id)}">
        <div class="c-head"><b>${h(c.name)}</b> ${commentRoleBadge(c)}
          ${c.matchId ? `<span class="c-target">${h(targetLabel(st, c.matchId))}</span>` : ''}
          <time>${h(formatCommentTime(c.at))}</time>
          ${admin ? `<button type="button" class="small danger" data-del="${h(c.id)}">削除</button>` : ''}</div>
        <p>${h(c.text).replace(/\n/g, '<br>')}</p></li>`).join('')
    : '<li class="empty">まだコメントはありません。</li>';
}

export function renderComments() {
  const p = panel();
  if (!isSharing()) {
    p.innerHTML = '<div class="card empty-state"><p>コメントは、大会を共有しているときに使えます。ヘッダーの「共有」から始めてください。</p></div>';
    p.dataset.built = '';
    return;
  }
  if (p.dataset.built !== '1') {
    p.innerHTML = formHtml();
    p.dataset.built = '1';
  }
  renderReports();
  updateTargets();
  updateList();
}

export function setupCommentsView() {
  const p = panel();
  setupReportView();
  p.addEventListener('input', (e) => {
    if (e.target.id === 'cf-text') document.getElementById('cf-count').textContent = `${e.target.value.length} / ${COMMENT_MAX}`;
  });
  p.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = document.getElementById('cf-text');
    const name = document.getElementById('cf-name');
    const err = document.getElementById('cf-error');
    err.textContent = '';
    if (!text.value.trim()) { err.textContent = 'コメントを入力してください'; return; }
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await postComment({ name: name.value, text: text.value, matchId: document.getElementById('cf-target').value });
      setCommentName(name.value.trim());
      text.value = '';
      document.getElementById('cf-count').textContent = `0 / ${COMMENT_MAX}`;
      toast('コメントを投稿しました');
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });
  p.addEventListener('click', async (e) => {
    const id = e.target.closest('[data-del]')?.dataset.del;
    if (!id || !confirm('このコメントを削除しますか？')) return;
    try {
      await deleteComment(id);
    } catch (ex) {
      toast(ex.message, { error: true });
    }
  });
}
