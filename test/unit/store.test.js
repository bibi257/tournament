import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, serializeState } from '../../src/core/state.js';

// 自動保存（localStorage）の差し替え。null のときは使えない環境（プライベートモード等）を再現する
let storage = null;
const KEY = 'bukatsu-taikai:state';
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  get() {
    if (!storage) throw new Error('localStorage is disabled');
    return {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    };
  },
});
const store = await import('../../src/ui/store.js');

const named = (name) => ({ ...createState(), players: [{ id: 'p1', name }] });

/** 閲覧を始めて、閲覧をやめるまでの流れ（共有の画面と同じ順序） */
function viewAndLeave(mutateWhileViewing) {
  store.setReadOnly(true);
  store.setRemoteState(named('他校'));
  store.setState(named('閲覧中の操作')); // 閲覧中の操作は反映されない
  mutateWhileViewing?.();
  store.setReadOnly(false);
  store.reloadLocal();
  return store.getState().players[0].name;
}

test('自動保存が使えないとき、閲覧をやめると閲覧前の自分の大会データに戻る', () => {
  storage = null;
  assert.equal(store.initState(), false);
  store.setState(named('山田'));
  assert.equal(viewAndLeave(), '山田');
});

test('別のタブで新しく保存された内容があれば、閲覧をやめたときにそれを使う（古い複製で上書きしない）', () => {
  storage = new Map();
  store.initState();
  store.setState(named('山田'));
  // 閲覧を始めたあと、別のタブで同じ端末の大会データが更新された
  assert.equal(viewAndLeave(() => storage.set(KEY, serializeState(named('佐藤')))), '佐藤');
});

test('別のタブで保存された内容を取り込む。「元に戻す」の履歴は引き継がず、保存はし直さない', () => {
  storage = new Map();
  store.initState();
  store.setState(named('山田'));
  store.setState(named('山田 太郎'));
  assert.equal(store.canUndo(), true);
  let rendered = 0;
  store.onChange(() => { rendered++; });
  const before = storage.get(KEY);

  assert.equal(store.adoptSaved(serializeState(named('佐藤'))), true);
  assert.equal(store.getState().players[0].name, '佐藤');
  assert.equal(rendered, 1);
  assert.equal(store.canUndo(), false); // 別の内容になったので、戻せない（戻すと、別のタブの変更を消してしまう）
  assert.equal(storage.get(KEY), before); // 取り込んだ側は保存しない（保存した側のタブが書いた内容を、書き直さない）

  // 読めない内容・消された（null）ときは、今の内容のまま
  assert.equal(store.adoptSaved('{abc'), false);
  assert.equal(store.adoptSaved(null), false);
  assert.equal(store.getState().players[0].name, '佐藤');
});

test('閲覧専用のあいだは、別のタブの保存を取り込まない（閲覧中の表示を変えない）', () => {
  storage = new Map();
  store.initState();
  store.setState(named('山田'));
  store.setReadOnly(true);
  store.setRemoteState(named('他校'));
  assert.equal(store.adoptSaved(serializeState(named('佐藤'))), false);
  assert.equal(store.getState().players[0].name, '他校');
  store.setReadOnly(false);
  store.reloadLocal();
});
