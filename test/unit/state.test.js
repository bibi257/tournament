import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, parseState, serializeState, playerName, defaultSettings, hasContent } from '../../src/core/state.js';
import { makePlayers, validatePlayers, resizeTables, movePlayer, nameKey } from '../../src/core/players.js';
import { generateTournament, setTournamentResult } from '../../src/core/bracket.js';
import { generateLeague } from '../../src/core/league.js';
import { normalizeResultInput } from '../../src/core/result.js';

test('保存→読込で同じ内容に戻る', () => {
  const st = createState();
  st.players = makePlayers(['山田', '佐藤', '鈴木']);
  st.tournament = generateTournament(st.players.map((p) => p.id), { seedCount: 1 });
  st.tournament = setTournamentResult(st.tournament, 'R1-M2', { score1: 3, score2: 1 }).tournament;
  st.league = generateLeague(st.players.map((p) => p.id));
  const r = parseState(serializeState(st));
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.state.players, st.players);
  assert.deepEqual(r.state.tournament, st.tournament);
  assert.deepEqual(r.state.league, st.league);
  assert.ok(r.state.meta.updatedAt);
});

test('不正なデータは読み込まない', () => {
  assert.equal(parseState('{abc').ok, false);
  assert.equal(parseState('[]').ok, false);
  assert.equal(parseState({ kind: 'other' }).ok, false);
  const st = createState();
  assert.equal(parseState({ ...st, version: 99 }).ok, false);
  assert.equal(parseState({ ...st, players: [{ id: 1 }] }).ok, false);
  assert.equal(parseState({ ...st, tables: [] }).ok, false);
  assert.equal(parseState({ ...st, tournament: { size: 3, slots: [], playerIds: [], results: {} } }).ok, false);
  assert.equal(parseState({ ...st, league: { matches: 'x' } }).ok, false);
  const r = parseState('{abc');
  assert.match(r.error, /JSON/);
});

test('足りない設定項目は既定値で補う', () => {
  const st = createState();
  delete st.settings.league;
  const r = parseState(JSON.stringify(st));
  assert.ok(r.ok);
  assert.equal(r.state.settings.league.win, 3);
});

test('名簿チェック: 空欄・重複（全角半角・空白の違いも重複）', () => {
  const ps = makePlayers(['山田 太郎', '', '山田太郎', 'ＡＢＣ', 'abc']);
  const { errors, invalidIds } = validatePlayers(ps);
  assert.equal(errors.length, 3);
  assert.ok(invalidIds.has(ps[1].id));
  assert.ok(invalidIds.has(ps[2].id));
  assert.ok(invalidIds.has(ps[4].id));
  assert.equal(nameKey('Ａ　B'), 'ab');
});

test('卓数の変更で既存の卓名を残す', () => {
  let t = resizeTables([], 2);
  t[0].name = 'A卓';
  t = resizeTables(t, 4);
  assert.equal(t.length, 4);
  assert.equal(t[0].name, 'A卓');
  assert.equal(t[3].name, '第4卓');
  assert.equal(resizeTables(t, 0).length, 1);
  assert.equal(resizeTables(t, 999).length, 50);
});

test('並べ替え', () => {
  const ps = makePlayers(['a', 'b', 'c']);
  assert.deepEqual(movePlayer(ps, 0, 1).map((p) => p.name), ['b', 'a', 'c']);
  assert.equal(movePlayer(ps, 0, -1), ps);
});

test('参加者名の表示: 不戦・未定・削除済み', () => {
  const st = createState();
  st.players = makePlayers(['山田']);
  assert.equal(playerName(st, st.players[0].id), '山田');
  assert.equal(playerName(st, null), '（不戦）');
  assert.equal(playerName(st, undefined), '');
  assert.equal(playerName(st, 'zzz'), '（削除された参加者）');
});

test('結果入力チェック', () => {
  const ok = (i, d = false) => normalizeResultInput(i, { allowDraw: d });
  assert.equal(ok({}).ok, false);
  assert.equal(ok({ walkover: true }).ok, false);
  assert.deepEqual(ok({ walkover: true, outcome: 'p2', score1: 3, score2: 0 }).value, { outcome: 'p2', score1: null, score2: null, walkover: true });
  assert.equal(ok({ score1: '1.5', score2: 0 }).ok, false);
  assert.equal(ok({ score1: 'a', score2: 0 }).ok, false);
  assert.equal(ok({ score1: 10000, score2: 0 }).ok, false);
  assert.equal(ok({ score1: ' 3 ', score2: '1' }).value.outcome, 'p1');
  assert.equal(ok({ outcome: 'draw' }, true).value.outcome, 'draw');
});

/** 正しい大会データ（4人・トーナメントと総当たりあり）を JSON 経由で複製して返す */
function validData() {
  const st = createState();
  st.players = makePlayers(['山田', '佐藤', '鈴木', '田中']);
  const ids = st.players.map((p) => p.id);
  st.tournament = generateTournament(ids, { thirdPlace: true });
  st.tournament = setTournamentResult(st.tournament, 'R1-M1', { score1: 2, score2: 1 }).tournament;
  st.league = generateLeague(ids);
  return JSON.parse(JSON.stringify(st));
}

test('ID に HTML として解釈される文字があるデータは読み込まない（XSS 対策）', () => {
  const evil = 'x"><img src=x onerror=alert(1)>';
  const cases = [
    (d) => { d.players[0].id = evil; },
    (d) => { d.tables[0].id = evil; },
    (d) => { d.league.matches[0].id = evil; },
    (d) => { d.tournament.results[evil] = d.tournament.results['R1-M1']; },
  ];
  assert.ok(parseState(validData()).ok);
  for (const mutate of cases) {
    const d = validData();
    mutate(d);
    assert.equal(parseState(d).ok, false, mutate.toString());
  }
  // 卓の手動割当の不正な値は捨てる（自動割当に戻るだけ）
  const d = validData();
  d.league.tableOverrides = { L1: evil, [evil]: d.tables[0].id, L2: d.tables[0].id };
  assert.deepEqual(parseState(d).state.league.tableOverrides, { L2: d.tables[0].id });
});

test('総当たり: 組み合わせの欠け・重複・不正な結果は読み込まない', () => {
  const cases = [
    (d) => { d.league.matches.pop(); }, // 組み合わせが欠けている（表のマスに試合がない）
    (d) => { d.league.matches[1] = { ...d.league.matches[0], id: 'L99' }; }, // 同じ組が2試合
    (d) => { d.league.matches[0].p2 = d.league.matches[0].p1; }, // 自分自身と対戦
    (d) => { d.league.matches[0].p1 = 'nobody'; },
    (d) => { d.league.results.L1 = { outcome: 'bogus' }; },
    (d) => { d.league.results.L1 = { outcome: 'p1', score1: '3', score2: 1 }; },
    (d) => { d.league.results.L999 = { outcome: 'p1' }; },
  ];
  for (const mutate of cases) {
    const d = validData();
    mutate(d);
    assert.equal(parseState(d).ok, false, mutate.toString());
  }
});

test('トーナメント: 枠と名簿の不一致・不正な結果は読み込まない', () => {
  const cases = [
    (d) => { d.tournament.slots[0] = 'nobody'; },
    (d) => { d.tournament.slots[1] = d.tournament.slots[0]; }, // 同じ選手が2枠
    (d) => { d.tournament.slots[0] = { id: 'x' }; },
    (d) => { d.tournament.size = 256; d.tournament.slots = Array(256).fill(null); },
    (d) => { d.tournament.results['R1-M1'].winnerId = 'nobody'; },
    (d) => { d.tournament.results['R1-M1'].score1 = -1; },
  ];
  for (const mutate of cases) {
    const d = validData();
    mutate(d);
    assert.equal(parseState(d).ok, false, mutate.toString());
  }
});

test('設定の不正な値は既定値に戻す（勝点が文字列でも計算が狂わない）', () => {
  const d = validData();
  d.settings = { seedCount: 'x', placement: '<b>', thirdPlace: 'yes', league: { win: '3', draw: 1.5, loss: -1, allowDraw: 'no' } };
  d.meta = { title: 5, date: null, extra: '<script>' };
  const r = parseState(d);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.state.settings, defaultSettings());
  assert.equal(r.state.meta.title, '部内大会');
  assert.equal('extra' in r.state.meta, false);
});

test('保存された結果も、勝者とスコアが矛盾していれば読み込まない', () => {
  const cases = [
    (d) => { d.league.results.L1 = { outcome: 'p1', score1: 3, score2: null }; }, // 片方だけのスコア
    (d) => { d.league.results.L1 = { outcome: 'p1', score1: 0, score2: 5 }; }, // 勝者とスコアが逆
    (d) => { d.league.results.L1 = { outcome: 'draw', score1: 2, score2: 1 }; }, // 引き分けなのに点差あり
    (d) => { d.league.results.L1 = { outcome: 'p1', score1: 2, score2: 2, walkover: true }; }, // 不戦勝にスコア
    (d) => { d.tournament.results['R1-M1'] = { ...d.tournament.results['R1-M1'], score1: 1, score2: 2 }; }, // 勝者が負けた側
    (d) => { d.tournament.results['R1-M1'] = { ...d.tournament.results['R1-M1'], score1: null }; }, // 片方だけのスコア
  ];
  for (const mutate of cases) {
    const d = validData();
    mutate(d);
    assert.equal(parseState(d).ok, false, mutate.toString());
  }
  // 正しい結果（スコアのみ・勝者のみ・不戦勝・総当たりの引き分け）は通る
  const ok = validData();
  ok.league.results = { L1: { outcome: 'draw', score1: 1, score2: 1, walkover: false }, L2: { outcome: 'p2', score1: null, score2: null, walkover: false } };
  ok.tournament.results = { 'R1-M1': { ...ok.tournament.results['R1-M1'], score1: null, score2: null, walkover: true } };
  assert.ok(parseState(ok).ok, parseState(ok).error);
});

test('トーナメントの枠は人数から決まり、不戦同士の組を含まない', () => {
  // 4人なのに枠が8
  const d = validData();
  d.tournament.size = 8;
  d.tournament.slots = [...d.tournament.slots, null, null, null, null];
  assert.equal(parseState(d).ok, false);

  // 5人の枠（8）で、1回戦の2組目が不戦同士
  const bye = validData();
  bye.players = makePlayers(['a', 'b', 'c', 'd', 'e']);
  const ids = bye.players.map((p) => p.id);
  bye.league = null;
  bye.tournament = { ...generateTournament(ids, {}), slots: [ids[0], ids[1], null, null, ids[2], ids[3], ids[4], null] };
  assert.equal(parseState(JSON.parse(JSON.stringify(bye))).ok, false, '不戦同士の組');
  bye.tournament.slots = [ids[0], null, ids[1], null, ids[2], ids[3], ids[4], null];
  assert.ok(parseState(JSON.parse(JSON.stringify(bye))).ok);
});

test('名前・卓名・大会名は、長さ・改行・双方向の制御文字を整えて読み込む', () => {
  const d = validData();
  d.players[0].name = 'あ'.repeat(10000);
  d.players[1].name = '山田\n太郎‮';
  d.tables[0].name = '第'.repeat(50);
  d.meta.title = 'x'.repeat(500);
  const r = parseState(d);
  assert.ok(r.ok, r.error);
  assert.equal(r.state.players[0].name.length, 40);
  assert.equal(r.state.players[1].name, '山田 太郎');
  assert.equal(r.state.tables[0].name.length, 20);
  assert.equal(r.state.meta.title.length, 60);
});

test('hasContent: 名簿・表・過去の大会のどれかがあれば、置き換える前に確認が要る', () => {
  const empty = createState();
  assert.equal(hasContent(empty), false);
  assert.equal(hasContent({ ...empty, players: makePlayers(['山田']) }), true);
  const ids = ['a', 'b'];
  assert.equal(hasContent({ ...empty, tournament: generateTournament(ids) }), true);
  assert.equal(hasContent({ ...empty, league: generateLeague(ids) }), true);
  // 名簿も表も空でも、過去の大会が残っていれば確認する（「全員削除」のあとの「新規」で、過去の大会が消えないように）
  assert.equal(hasContent({ ...empty, history: [{ edition: 1 }] }), true);
  // 古い形（history が無い）でも落ちない
  const { history: _drop, ...old } = empty;
  assert.equal(hasContent(old), false);
});
