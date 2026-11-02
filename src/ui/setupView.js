// 参加者・設定タブ

import { getState, setState } from './store.js';
import { h, toast, readFileBytes } from './io.js';
import { makePlayers, validatePlayers, movePlayer, resizeTables, cleanName, setupProgress, MAX_TABLES } from '../core/players.js';
import { generateTournament, bracketSize, MAX_PLAYERS, MIN_PLAYERS } from '../core/bracket.js';
import { generateLeague, MAX_LEAGUE_PLAYERS } from '../core/league.js';
import { decodeText, namesFromCSV } from '../core/csv.js';
import { editionsCardHtml, keepEditionsFold } from './editions.js';
import { localToday, validateSchedule } from '../core/schedule.js';
import { planSeeds, effectiveSeedCount, seedOrderNumbers } from '../core/seeds.js';
import {
  attendanceCount, isAbsent, presentPlayers, setAbsent, allPresent, absenceImpact,
  applyTournamentWalkovers, applyLeagueWalkovers, applyWalkovers, stopWalkover,
} from '../core/attendance.js';
import { playerName } from '../core/state.js';
import { askChoice } from './choiceDialog.js';
import { openPairing } from './pairingDialog.js';

const panel = () => document.getElementById('panel-setup');

function hasResults(obj) {
  return !!obj && Object.keys(obj.results || {}).length > 0;
}

export function renderSetup() {
  keepEditionsFold();
  const st = getState();
  const n = st.players.length;
  const s = st.settings;
  const size = n >= 2 ? bracketSize(n) : 0;
  const pick = s.seedMode === 'pick';
  const picked = new Set(s.seedIds);
  const seedNo = seedOrderNumbers(st.players, s);
  const seedN = effectiveSeedCount(s, st.players);
  const att = attendanceCount(st.players);
  panel().innerHTML = `
  ${stepsHtml(setupProgress(st))}
  <div class="grid-2">
    <div class="stack">
      <div class="card" id="setup-info">
        <h2>大会情報</h2>
        <div class="form-row"><label for="meta-title">大会名</label><input type="text" id="meta-title" class="field-grow" value="${h(st.meta.title)}" maxlength="60"></div>
        <div class="form-row schedule-row"><label for="meta-date">開催日時</label>
          <input type="date" id="meta-date" value="${h(st.meta.date)}" min="${localToday()}">
          <input type="time" id="meta-time" value="${h(st.meta.time)}" aria-label="開始時刻" ${st.meta.date ? '' : 'disabled'}>
          ${st.meta.date ? '<button type="button" class="small" data-act="clear-schedule">日時を消す</button>' : ''}</div>
        <p class="hint">過去の日付・時刻は設定できません。時刻は決まっていなければ空欄のままで構いません（日付を入れると時刻を入力できます）。</p>
        <p class="error" id="schedule-error" role="alert"></p>
      </div>
      <div class="card" id="setup-players">
        <h2>参加者 <span class="muted" id="player-count">${n}人</span>
          <span class="spacer"></span>
          <span class="h2-actions">
            <button type="button" data-act="import">一括入力・CSV取込</button>
            <button type="button" class="danger" data-act="clear-players" ${n ? '' : 'disabled'}>全員削除</button>
          </span>
        </h2>
        <p class="hint">${pick
          ? 'シードにしたい選手に、名前の左のチェックを付けてください。シードの順位は名簿の上から順です（↑↓で並べ替え）。'
          : 'シードの決め方は、右の「トーナメント」で選べます（ランダム／名簿でチェックして指名）。'}名前は作成後も変更でき、表に反映されます。</p>
        ${n ? `<div class="attendance-bar">
          <span class="attend-count${att.absent ? ' has-absent' : ''}" id="attend-count">出席 ${att.present} / ${att.total}人</span>
          <button type="button" data-act="all-present" ${att.absent ? '' : 'disabled'}>全員出席にする</button>
          <span class="muted">当日来ない人は、名前の左の「出席」のチェックを外してください。</span>
        </div>` : ''}
        <ul class="errors" id="player-errors" hidden></ul>
        ${n ? '' : `<div class="empty-state roster-empty" id="roster-empty">
          <p>まず参加者を入力しましょう。</p>
          <div class="empty-actions">
            <button type="button" class="primary" data-act="focus-add">名前を入力して追加</button>
            <button type="button" data-act="import">一括入力・CSV取込</button>
          </div>
        </div>`}
        ${n ? `<div class="table-wrap">
          <table class="data players">
            <thead><tr><th class="num">No</th><th class="attend-col">出席</th>${pick ? '<th class="seed-col">シード</th>' : ''}<th>名前</th><th>並べ替え・削除</th></tr></thead>
            <tbody>
              ${st.players.map((p, i) => `
              <tr data-id="${h(p.id)}"${isAbsent(p) ? ' class="absent"' : ''}>
                <td class="idx">${i + 1}</td>
                <td class="attend-cell"><label class="attend-pick"><input type="checkbox" class="attend-box" data-id="${h(p.id)}" ${isAbsent(p) ? '' : 'checked'} aria-label="${h(p.name || `${i + 1}番目`)}は出席"></label></td>
                ${pick ? `<td class="seed-cell"><label class="seed-pick"><input type="checkbox" class="seed-pick-box" data-id="${h(p.id)}" ${picked.has(p.id) ? 'checked' : ''} aria-label="${h(p.name || `${i + 1}番目`)}をシードにする">${seedNo.has(p.id) ? `<span class="seed-badge">第${seedNo.get(p.id)}シード</span>` : ''}</label></td>` : ''}
                <td><input type="text" class="name" data-id="${h(p.id)}" value="${h(p.name)}" maxlength="40" aria-label="${i + 1}番目の名前"></td>
                <td class="ops">
                  <button type="button" class="icon" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
                  <button type="button" class="icon" data-act="down" data-i="${i}" ${i === n - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
                  <button type="button" class="icon danger" data-act="del" data-i="${i}" aria-label="削除">×</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}
        <form class="add-row" id="add-player-form">
          <input type="text" id="new-player" placeholder="名前を入力して Enter で追加" maxlength="40" aria-label="追加する参加者名">
          <button type="submit">追加</button>
        </form>
      </div>
    </div>
    <div class="stack">
      <div class="card" id="setup-tables">
        <h2>卓</h2>
        <div class="form-row"><label for="table-count">使用する卓の数</label>
          <input type="number" id="table-count" class="field-w-6" min="1" max="${MAX_TABLES}" value="${st.tables.length}"></div>
        <p class="hint">各回戦の試合を卓へ順番に割り当てます。卓数より試合が多いときは「時間帯」が2, 3…と分かれます。</p>
        <div class="tables-list">
          ${st.tables.map((t, i) => `<input type="text" class="table-name" data-id="${h(t.id)}" value="${h(t.name)}" maxlength="20" aria-label="卓${i + 1}の名前">`).join('')}
        </div>
      </div>
      <div class="card" id="setup-tournament">
        <h2>トーナメント</h2>
        <div class="form-row"><label for="seed-mode">シード</label>
          <select id="seed-mode">
            <option value="none" ${s.seedMode === 'none' ? 'selected' : ''}>なし</option>
            <option value="random" ${s.seedMode === 'random' ? 'selected' : ''}>ランダムに決める</option>
            <option value="pick" ${pick ? 'selected' : ''}>名簿で指名する（チェック）</option>
          </select>
          ${s.seedMode === 'random' ? `<label for="seed-count">人数</label><input type="number" id="seed-count" class="field-w-55" min="0" max="${n}" value="${Math.min(s.seedCount, n)}">` : ''}
          ${pick ? `<span class="muted">指名 ${seedN}人</span>` : ''}</div>
        <p class="hint">${s.seedMode === 'random' ? '表を作成（作り直し）するたびに、全員から抽選します。' : pick ? '「参加者」の名簿でチェックした選手がシードです。' : ''}${n >= 2 ? `枠 ${size}・1回戦不戦（シード上位から） ${size - n}枠` : ''}</p>
        <div class="form-row"><label for="placement">シード以外の配置</label>
          <select id="placement">
            <option value="order" ${s.placement === 'order' ? 'selected' : ''}>名簿順</option>
            <option value="random" ${s.placement === 'random' ? 'selected' : ''}>抽選（ランダム）</option>
          </select></div>
        <div class="form-row"><label for="third-place">3位決定戦</label>
          <label><input type="checkbox" id="third-place" ${s.thirdPlace ? 'checked' : ''}> 行う</label></div>
        <p class="hint">シードの決め方・配置・3位決定戦は、表を作成（作り直し）したときに反映されます。</p>
        ${createHtml('gen-tournament', st.tournament, 'トーナメント表')}
      </div>
      <div class="card" id="setup-league">
        <h2>総当たり</h2>
        <div class="form-row pt-row"><label>勝点</label>
          <div class="pt-grid">
            <label>勝 <input type="number" id="pt-win" min="0" max="99" value="${s.league.win}"></label>
            <label>分 <input type="number" id="pt-draw" min="0" max="99" value="${s.league.draw}"></label>
            <label>敗 <input type="number" id="pt-loss" min="0" max="99" value="${s.league.loss}"></label>
          </div></div>
        <div class="form-row"><label for="allow-draw">引き分け</label>
          <label><input type="checkbox" id="allow-draw" ${s.league.allowDraw ? 'checked' : ''}> あり</label></div>
        <p class="hint">順位は 勝点 → 同勝点内の直接対決 → 得失点差 → 総得点 の順に決めます。勝点の変更はすぐ反映されます。</p>
        ${createHtml('gen-league', st.league, '総当たり表')}
      </div>
    </div>
  </div>
  ${editionsCardHtml(st)}`;
  updateValidation();
}

const STEPS = [
  { target: 'setup-info', no: 1, label: '大会情報と参加者', key: 'players' },
  { target: 'setup-tables', no: 2, label: '卓と形式', key: 'tables' },
  { target: 'setup-create', no: 3, label: '表を作成', key: 'created' },
];

/** タブ最上部の3段階。押すとその位置へスクロールする。済んだ段階にはチェック印を付ける */
function stepsHtml(progress) {
  return `<nav class="steps" aria-label="作成の流れ"><ol>${STEPS.map((p) => {
    const done = p.key && progress[p.key];
    return `<li><button type="button" class="step ${done ? 'done' : ''}" data-act="step" data-target="${p.target}" aria-label="${p.no} ${p.label}${done ? '（済み）' : ''}">`
      + `<span class="step-no" aria-hidden="true">${done ? '✓' : p.no}</span><span class="step-label">${p.label}</span></button></li>`;
  }).join('')}</ol></nav>`;
}

/** 3段階の表示だけを作り直す（入力中は画面全体を再描画しないため） */
function refreshSteps() {
  const nav = panel().querySelector('.steps');
  if (nav) nav.outerHTML = stepsHtml(setupProgress(getState()));
}

/** 表を作成するボタン（カードの下で全幅）。作成済みのときは「作り直す」にして、結果が消えることを添える */
function createHtml(act, made, name) {
  return `${made ? '<p class="hint create-note">作り直すと、入力済みの結果はすべて消えます。</p>' : ''}
        <button type="button" class="primary create-btn" data-act="${act}"${act === 'gen-tournament' ? ' id="setup-create"' : ''}>${name}を${made ? '作り直す' : '作成'}</button>`;
}

/** 名簿のエラー表示だけを更新（入力中に再描画しないため） */
function updateValidation() {
  const st = getState();
  const { errors, invalidIds } = validatePlayers(st.players);
  const ul = document.getElementById('player-errors');
  if (!ul) return { errors };
  ul.hidden = errors.length === 0;
  ul.innerHTML = errors.map((e) => `<li>${h(e)}</li>`).join('');
  panel().querySelectorAll('input.name').forEach((el) => el.classList.toggle('invalid', invalidIds.has(el.dataset.id)));
  return { errors };
}

function update(patch, opts) {
  setState({ ...getState(), ...patch }, opts);
}

function updateSettings(patch, opts = { render: false }) {
  const st = getState();
  setState({ ...st, settings: { ...st.settings, ...patch } }, opts);
}

function intVal(el, min, max, fallback) {
  const v = parseInt(el.value, 10);
  if (Number.isNaN(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function usedIn(st, id) {
  return (st.tournament?.playerIds.includes(id)) || (st.league?.playerIds.includes(id));
}

/** 名簿の名前の確認と、人数の確認。n は表に入れる人数 */
function canGenerate(min, max, label, n = getState().players.length) {
  const { errors } = updateValidation();
  if (errors.length) { toast('参加者の名前を確認してください（空欄・重複があります）', { error: true }); return false; }
  if (n < min) { toast(`${label}には${min}人以上必要です`, { error: true }); return false; }
  if (n > max) { toast(`${label}は${max}人までです`, { error: true }); return false; }
  return true;
}

/**
 * 欠席者がいるときの作り方を選ぶ。欠席者がいなければ聞かない（'all'）。
 * @returns {Promise<'all'|'exclude'|'walkover'|null>} null はキャンセル
 */
async function chooseAbsentHandling(st, label) {
  const { absent, present } = attendanceCount(st.players);
  if (!absent) return 'all';
  return askChoice({
    title: `${label}を作成`,
    body: `欠席の人が${absent}人います（出席 ${present}人）。`,
    okLabel: '作成',
    options: [
      { value: 'exclude', label: '欠席の人を除いて作る', hint: `出席の${present}人で表を作ります。欠席の人は表に入りません。` },
      { value: 'walkover', label: '欠席の人を入れたまま作り、その試合を不戦にする', hint: '表には全員が入ります。欠席の人が出る試合は、相手の不戦勝になります。' },
    ],
  });
}

async function generateTournamentFromSetup() {
  let st = getState();
  if (!canGenerate(MIN_PLAYERS, MAX_PLAYERS, 'トーナメント', st.players.length)) return;
  const how = await chooseAbsentHandling(st, 'トーナメント表');
  if (how === null) return;
  st = getState();
  const list = how === 'exclude' ? presentPlayers(st.players) : st.players;
  if (how !== 'all' && attendanceCount(st.players).present < MIN_PLAYERS) { toast(`出席の人が${MIN_PLAYERS}人以上必要です`, { error: true }); return; }
  if (!canGenerate(MIN_PLAYERS, MAX_PLAYERS, 'トーナメント', list.length)) return;
  if (st.tournament && !confirm(hasResults(st.tournament)
    ? 'トーナメント表を作り直すと、入力済みの結果はすべて消えます。作り直しますか？'
    : 'トーナメント表を作り直しますか？')) return;
  // 組み合わせを確認する（入れ替え・抽選のやり直しができる）。確定するまで大会データは変えない
  let plan = planSeeds(list, st.settings);
  const absentIds = new Set(st.players.filter(isAbsent).map((p) => p.id));
  let t = await openPairing({
    make: (slots) => generateTournament(plan.playerIds, { ...st.settings, seedCount: plan.seedCount, slots }),
    redraw: st.settings.seedMode === 'random' || st.settings.placement === 'random' ? () => { plan = planSeeds(list, st.settings); } : null,
    tables: st.tables,
    nameOf: (id) => playerName(st, id),
    seedNo: () => new Map(plan.playerIds.slice(0, plan.seedCount).map((id, i) => [id, i + 1])),
    absentIds: how === 'walkover' ? absentIds : new Set(),
  });
  if (!t) return;
  st = getState();
  let skipped = 0;
  if (how === 'walkover') {
    const r = applyTournamentWalkovers(t, absentIds);
    t = r.tournament;
    skipped = r.count;
  }
  setState({ ...st, tournament: t }, { render: false });
  toast(`トーナメント表を作成しました${how === 'exclude' ? `（欠席の${attendanceCount(st.players).absent}人を除きました）` : how === 'walkover' ? `（欠席の人の試合${skipped}件を不戦にしました）` : ''}`);
  window.dispatchEvent(new CustomEvent('app:tab', { detail: 'tournament' }));
}

async function generateLeagueFromSetup() {
  let st = getState();
  if (!canGenerate(2, MAX_LEAGUE_PLAYERS, '総当たり', st.players.length)) return;
  const how = await chooseAbsentHandling(st, '総当たり表');
  if (how === null) return;
  st = getState();
  const list = how === 'exclude' ? presentPlayers(st.players) : st.players;
  if (how !== 'all' && attendanceCount(st.players).present < 2) { toast('出席の人が2人以上必要です', { error: true }); return; }
  if (!canGenerate(2, MAX_LEAGUE_PLAYERS, '総当たり', list.length)) return;
  if (st.league && !confirm(hasResults(st.league)
    ? '総当たり表を作り直すと、入力済みの結果はすべて消えます。作り直しますか？'
    : '総当たり表を作り直しますか？')) return;
  let l = generateLeague(list.map((p) => p.id));
  let skipped = 0;
  if (how === 'walkover') {
    const r = applyLeagueWalkovers(l, new Set(st.players.filter(isAbsent).map((p) => p.id)));
    l = r.league;
    skipped = r.count;
  }
  setState({ ...st, league: l }, { render: false });
  toast(`総当たり表を作成しました${how === 'exclude' ? `（欠席の${attendanceCount(st.players).absent}人を除きました）` : how === 'walkover' ? `（欠席の人の試合${skipped}件を不戦にしました）` : ''}`);
  window.dispatchEvent(new CustomEvent('app:tab', { detail: 'league' }));
}

/** 「出席」のチェックを変えたとき。作成済みの表に出る試合が残っていれば、不戦にするかを聞く */
async function changeAttendance(box) {
  const st = getState();
  const id = box.dataset.id;
  const player = st.players.find((p) => p.id === id);
  if (!player) return;
  const absent = !box.checked;
  const render = () => update({}, { render: true });
  if (!absent) {
    // 出席に戻す: すでに入った不戦の結果は変えない。以後の試合を不戦にする対象から外す
    update({ players: setAbsent(st.players, id, false), tournament: st.tournament ? stopWalkover(st.tournament, id) : st.tournament });
    return;
  }
  const next = { ...st, players: setAbsent(st.players, id, true) };
  const { now, later } = absenceImpact(next, id);
  if (!now && !later) { setState(next); return; }
  const name = player.name || '（空欄）';
  const how = await askChoice({
    title: `「${name}」を欠席にする`,
    body: now
      ? `作成済みの表に、この人が出る未実施の試合が${now}件あります。`
      : 'この人は作成済みのトーナメントで、勝ち上がった先の試合に出る予定です。',
    okLabel: '決定',
    options: [
      { value: 'walkover', label: '不戦にする（相手の不戦勝）', hint: '欠席の人が出る試合を、相手の不戦勝にします。トーナメントでは、あとから対戦相手が決まった試合も不戦になります。' },
      { value: 'record', label: '欠席の記録だけ残す', hint: '表の試合はそのままです。結果は自分で入力してください。' },
    ],
  });
  if (how === null) { render(); return; } // 取りやめ（チェックを元に戻す）
  if (how === 'record') { setState(next); return; }
  const r = applyWalkovers(next, [id]);
  setState(r.state);
  toast(r.count ? `「${name}」の試合${r.count}件を不戦にしました` : `「${name}」を欠席にしました（出る試合が決まったら不戦にします）`);
}

function onClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const st = getState();
  const act = btn.dataset.act;
  const i = Number(btn.dataset.i);
  if (act === 'step') {
    const el = document.getElementById(btn.dataset.target);
    if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: btn.dataset.target === 'setup-create' ? 'center' : 'start' });
  } else if (act === 'up' || act === 'down') {
    update({ players: movePlayer(st.players, i, act === 'up' ? -1 : 1) });
  } else if (act === 'del') {
    const p = st.players[i];
    const msg = usedIn(st, p.id)
      ? `「${p.name || '（空欄）'}」は作成済みの表に含まれています。削除すると表を作り直すまで「削除された参加者」と表示されます。削除しますか？`
      : `「${p.name || '（空欄）'}」を削除しますか？`;
    if (!confirm(msg)) return;
    update({ players: st.players.filter((_, j) => j !== i) });
  } else if (act === 'clear-players') {
    if (!confirm(`参加者 ${st.players.length}人をすべて削除しますか？`)) return;
    update({ players: [] });
  } else if (act === 'clear-schedule') {
    update({ meta: { ...st.meta, date: '', time: '' } });
  } else if (act === 'import') {
    openImport();
  } else if (act === 'focus-add') {
    document.getElementById('new-player')?.focus();
  } else if (act === 'all-present') {
    const tournament = st.tournament && st.players.filter(isAbsent).reduce((t, p) => stopWalkover(t, p.id), st.tournament);
    update({ players: allPresent(st.players), tournament });
  } else if (act === 'gen-tournament') {
    generateTournamentFromSetup();
  } else if (act === 'gen-league') {
    generateLeagueFromSetup();
  }
}

function onInput(e) {
  const el = e.target;
  const st = getState();
  if (el.matches('input.name')) {
    const players = st.players.map((p) => (p.id === el.dataset.id ? { ...p, name: cleanName(el.value) } : p));
    update({ players }, { render: false, merge: true });
    updateValidation();
  } else if (el.matches('input.table-name')) {
    update({ tables: st.tables.map((t) => (t.id === el.dataset.id ? { ...t, name: el.value.slice(0, 20) } : t)) }, { render: false, merge: true });
    refreshSteps(); // 名前を空にした・入れたとき、「2 卓と形式」のチェックを今つける・外す
  } else if (el.id === 'meta-title') {
    update({ meta: { ...st.meta, title: el.value } }, { render: false, merge: true });
    document.getElementById('print-title').textContent = el.value;
  }
}

/** 開催日時の変更。過去の日時は受け付けず、元の値に戻す（日付・時刻が変わるたびに検査する） */
function changeSchedule(el) {
  const st = getState();
  const date = document.getElementById('meta-date').value;
  const time = date ? document.getElementById('meta-time').value : '';
  const err = validateSchedule(date, time);
  const msg = document.getElementById('schedule-error');
  if (err) {
    msg.textContent = err;
    el.value = el.id === 'meta-date' ? st.meta.date : st.meta.time; // 元の値に戻す
    return;
  }
  msg.textContent = '';
  update({ meta: { ...st.meta, date, time } }, { render: el.id === 'meta-date' }); // 日付の有無で時刻欄・ボタンの状態が変わる
}

function onChangeEvt(e) {
  const el = e.target;
  const st = getState();
  if (el.id === 'meta-date' || el.id === 'meta-time') {
    changeSchedule(el);
  } else if (el.id === 'table-count') {
    const n = intVal(el, 1, MAX_TABLES, st.tables.length);
    update({ tables: resizeTables(st.tables, n) });
  } else if (el.id === 'seed-mode') {
    updateSettings({ seedMode: ['random', 'pick'].includes(el.value) ? el.value : 'none' }, { render: true });
  } else if (el.id === 'seed-count') {
    updateSettings({ seedCount: intVal(el, 0, st.players.length, 0) }, { render: true });
  } else if (el.matches('input.attend-box')) {
    changeAttendance(el);
  } else if (el.matches('input.seed-pick-box')) {
    const ids = new Set(st.settings.seedIds);
    if (el.checked) ids.add(el.dataset.id); else ids.delete(el.dataset.id);
    updateSettings({ seedIds: [...ids] }, { render: true });
  } else if (el.id === 'placement') {
    updateSettings({ placement: el.value === 'random' ? 'random' : 'order' });
  } else if (el.id === 'third-place') {
    updateSettings({ thirdPlace: el.checked });
  } else if (['pt-win', 'pt-draw', 'pt-loss'].includes(el.id) || el.id === 'allow-draw') {
    const p = (id, fb) => intVal(document.getElementById(id), 0, 99, fb);
    updateSettings({ league: {
      win: p('pt-win', st.settings.league.win), draw: p('pt-draw', st.settings.league.draw),
      loss: p('pt-loss', st.settings.league.loss), allowDraw: document.getElementById('allow-draw').checked,
    } }, { render: true });
  } else if (el.matches('input.name')) {
    // 確定時に前後の空白を除いた値で再表示
    el.value = cleanName(el.value);
  }
}

function onSubmit(e) {
  if (e.target.id !== 'add-player-form') return;
  e.preventDefault();
  const input = document.getElementById('new-player');
  const name = cleanName(input.value);
  if (!name) { input.focus(); return; }
  const st = getState();
  if (st.players.length >= MAX_PLAYERS) { toast(`参加者は${MAX_PLAYERS}人までです`, { error: true }); return; }
  update({ players: [...st.players, ...makePlayers([name])] });
  document.getElementById('new-player').focus();
}

// ---- 一括入力・CSV取込 ----
function openImport() {
  const dlg = document.getElementById('import-dialog');
  document.getElementById('im-text').value = '';
  document.getElementById('im-error').textContent = '';
  document.getElementById('im-file-name').textContent = '';
  dlg.showModal();
  document.getElementById('im-text').focus();
}

function setupImport() {
  const dlg = document.getElementById('import-dialog');
  const file = document.getElementById('im-file');
  document.getElementById('im-file-btn').addEventListener('click', () => file.click());
  document.getElementById('im-cancel').addEventListener('click', () => dlg.close());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const names = namesFromCSV(decodeText(await readFileBytes(f)));
      document.getElementById('im-text').value = names.join('\n');
      document.getElementById('im-file-name').textContent = `${f.name}（${names.length}人）`;
    } catch {
      document.getElementById('im-error').textContent = 'ファイルを読み込めませんでした';
    }
    file.value = '';
  });
  document.getElementById('import-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const names = namesFromCSV(document.getElementById('im-text').value).map(cleanName).filter(Boolean);
    if (!names.length) { document.getElementById('im-error').textContent = '名前が入力されていません'; return; }
    const st = getState();
    const replace = document.querySelector('input[name="im-mode"]:checked').value === 'replace';
    const base = replace ? [] : st.players;
    if (base.length + names.length > MAX_PLAYERS) {
      document.getElementById('im-error').textContent = `参加者は${MAX_PLAYERS}人までです（取込後 ${base.length + names.length}人）`;
      return;
    }
    if (replace && st.players.length && !confirm(`今の名簿（${st.players.length}人）を置き換えますか？`)) return;
    update({ players: [...base, ...makePlayers(names)] });
    dlg.close();
    toast(`${names.length}人を取り込みました`);
  });
}

export function setupSetupView() {
  const p = panel();
  p.addEventListener('click', onClick);
  p.addEventListener('input', onInput);
  p.addEventListener('change', onChangeEvt);
  p.addEventListener('submit', onSubmit);
  setupImport();
}
