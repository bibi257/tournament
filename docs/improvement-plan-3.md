# 大会運営アプリ 改善計画（第3弾・コードの読み直し）

作成日：2026-11-15（前回までの計画は docs/ui-plan.md・docs/ui-plan-2.md）

## 進め方

`main`（PR #75 まで）のコードを、Haiku のサブエージェント6体に領域を分けて全文を読み直させた（対戦ロジック／出力・補助ロジック／共有サーバー／設定・保存の画面／表・進行の画面／追加機能の案出し）。出てきた指摘は、1件ずつコードを読むか実際に関数を呼んで確かめ、確かめられたものだけを載せた。確かめられなかったものは「未確認」と書いた。

ID は、修正が M、追加機能が A。必要度は、高＝データが消える・壊れる・誤った出力が出る／中＝条件つきで困る・見た目や操作の不具合／低＝害が小さい。規模は、小＝半日以内／中＝1〜2回の依頼／大＝2回以上。

## 一覧

| ID | 項目 | 必要度 | 規模 | 状態 |
| --- | --- | --- | --- | --- |
| M1 | 「新規」「読込」で、過去の大会が確認なしで消える | 高 | 小 | 実装済み |
| M2 | 名簿の取込: セルの途中の引用符で、後ろの行が1人の名前になる | 高 | 小 | 実装済み |
| M3 | 名簿の取込: Excel の「Unicode テキスト」（UTF-16）が文字化けする | 中 | 小 | 実装済み |
| M4 | 試合結果の CSV のスコア「3-1」が、Excel で日付になる | 高 | 小 | 実装済み（Excel での表示は未検証） |
| M5 | 共有: 運営の入り直しで、キャンセル・Esc が公開データを上書きする | 高 | 小 | 実装済み |
| M6 | 共有: 応答が返らないと、送信が止まったままになる | 高 | 小 | 実装済み |
| M7 | 同じブラウザの2つのタブで、古いタブが新しい変更を上書きする | 高 | 小 | 実装済み |
| M8 | 両方欠席の試合で、欠席者が勝ち上がり、表彰・順位に載る | 中 | 中 | 判断待ち |
| M9 | 共有: 運営ログインの失敗の制限が、同時の送信で効かない | 中 | 中 | 未実装 |
| M10 | 共有: IPv6 では、IP ごとの制限が1つの回線で効かない | 中 | 小 | 未実装 |
| M11 | トーナメント表で、長い名前が枠からはみ出す | 中 | 小 | 未実装 |
| M12 | 過去の大会を見て戻ると、保存に失敗していた入力が消える | 中 | 小 | 未実装 |
| M13 | 結果のカードで、スコアが無い試合の勝者が太字だけで示される | 中 | 小 | 未実装 |
| M14 | 回戦のタブが、押すとフォーカスを失う。タブの役割の表記が操作と合わない | 中 | 小 | 未実装 |
| M15 | 引き分けの報告が、トーナメントの試合でも「承認」できるように見える | 低 | 小 | 未実装 |
| M16 | 共有: 報告の「同じ人は同じ試合1回」が、同時の送信で守られない | 低 | 小 | 未実装 |
| M17 | 名前・ファイル名の上限で、絵文字などが途中で切れる | 低 | 小 | 未実装 |
| M18 | 試合の開始時刻に、存在しない日付（2月30日）を受け入れる | 低 | 小 | 未実装 |
| M19 | 結果入力・取込のダイアログを Esc で閉じると、入力が確認なしで消える | 低 | 小 | 未実装 |
| M20 | 日本語入力の変換中の Enter で、参加者が追加されることがある | 低 | 小 | 未確認（Safari） |
| M21 | トーナメントで結果を保存したあと、フォーカスが試合に戻らない | 低 | 小 | 未確認 |
| M22 | トーナメント表の大きさの監視が、描き直すたびに増える | 低 | 小 | 未実装 |
| M23 | 「開始を取り消す」ボタン（卓未定の次の試合）に受け手がない | 低 | 小 | 未実装 |
| M24 | 表の見出し（th）に scope がない | 低 | 小 | 未実装 |
| M25 | スマホの対戦表のマスの、押せる大きさが決まっていない | 低 | 小 | 未確認 |
| M26 | 共有: 運営トークンを localStorage に保存している | 低 | 小 | 判断待ち |
| M27 | 共有: 本文の大きさを、全部読んでから検査する | 低 | 小 | 未実装 |
| M28 | 保存ファイルの名前に「第N回」が入らない | 低 | 小 | 未実装 |
| M29 | Windows 版で、保存先を聞かずにダウンロードフォルダへ入る | 低 | 小 | 未確認 |
| M30 | core の関数が、想定外の引数で例外になる | 低 | 小 | 未実装 |
| A1 | 1試合ごとの予定時刻を出す | 高 | 小 | 提案 |
| A2 | 次の試合の案内文をコピーする | 高 | 小 | 提案 |
| A3 | 参加者の所属を入れ、1回戦で同じ所属の対戦を避ける | 中 | 中 | 提案 |
| A4 | 受付用の名簿を CSV・印刷で出す | 中 | 小 | 提案 |
| A5 | 総当たりの同率を、運営が順位を決めて確定する | 中 | 小〜中 | 提案 |
| A6 | 呼び出し画面で、試合が変わったときに音と目印を出す | 低 | 小 | 提案 |
| A7 | 賞状を PNG で出す | 低 | 中 | 提案 |
| A8 | 閲覧者に「自分の試合が近い」通知を出す | 低 | 中 | 提案 |

おすすめの順：M9・M10（共有の制限）→ M11・M13・M14（見た目と操作）→ M15〜M18（小さく確実な修正をまとめて1回）→ M8（方針を決めてから）。追加機能は A1・A2 が小さく、当日の手間を直接減らす。

---

## 1. 実装済み（この計画と同じ PR）

### M1. 「新規」「読込」で、過去の大会が確認なしで消える
- 現象：「第2回大会を始める」→「全員削除」→「新規」とすると、確認が出ないまま過去の大会がすべて消えた。「読込」も同じ。確認を出す条件（`hasData`）が、名簿と表だけを見ていた
- 修正：`src/core/state.js` に `hasContent(st)`（名簿・表・過去の大会のどれかがあるか）を足し、`src/ui/main.js` の「新規」「読込」で使う。確認文に「過去の大会（N回分）も消えます／置き換わります」を足した。「読込」の確認にも、共有中の注意を足した。読込の通知の大会名は `eventTitle` にした
- テスト：`test/unit/state.test.js`（hasContent）、`test/e2e/edition.spec.js`（全員削除のあとの新規・読込で確認が出て、キャンセルすると残る）

### M2. 名簿の取込: セルの途中の引用符で、後ろの行が1人の名前になる
- 現象：`山"田,1年` の行があると、閉じる引用符が無いため、後ろの行がすべて1つのセルに入り、3人が1人になった（エラーにならない）
- 修正：`src/core/csv.js` の `parseCSV` で、引用符はセルの先頭（前に空白だけ）にあるときだけ囲みの始まりとみなす
- テスト：`test/unit/csv.test.js`

### M3. 名簿の取込: Excel の「Unicode テキスト」（UTF-16）が文字化けする
- 現象：UTF-16 のファイルが Shift_JIS と判定され、文字化けした名前が入った
- 修正：`decodeText` で、先頭の BOM（FF FE／FE FF）を見て UTF-16 として読む。あわせて `namesFromCSV` で、1行目がタブ区切りの見出し（「名前」などを含む）のときは、タブで列に分ける（Excel の「Unicode テキスト」と、セルの貼り付けはタブ区切りのため）。見出しの無いタブ入りの行は、これまでどおり1つの名前として読む
- テスト：`test/unit/csv.test.js`

### M4. 試合結果の CSV のスコア「3-1」が、Excel で日付になる
- 現象：試合結果一覧の CSV のスコア列は `3-1` のまま出ていた。Excel は CSV を開くとき、この形を日付（3月1日）に変える（`21-19` のように日付にならない値は変わらないので、列の中で表示がばらつく）
- 修正：`src/core/csv.js` の `escapeCell` で、`数字-数字` の形のセルを `="3-1"` の形で出す（PLAN D67）。画面・PNG・対戦表の「○ 3-1」は変えない
- テスト：`test/unit/csv.test.js`、`test/e2e/app.spec.js`
- 未検証：実際の Excel での表示（この環境に Excel が無い）。`="3-1"` は Excel・Google スプレッドシート・LibreOffice では「3-1」と表示される想定。メモ帳などでは `"=""3-1"""` と見える

### M5. 共有: 運営の入り直しで、キャンセル・Esc が公開データを上書きする
- 現象：公開済みのデータがある共有へ、別の端末から運営として入ると、confirm が出た（OK＝読み込む、キャンセル＝この端末の内容で公開し直す）。キャンセル・Esc で閉じただけで、公開済みのデータが、この端末の内容（新しい端末なら空）に置き換わった
- 修正：`src/ui/share.js` の `joinAdmin` で、選択式のダイアログ（`askChoice`）に変えた。キャンセル・Esc では、どちらも変えずに運営ログインを取りやめる。運営セッションは、どうするかが決まってから始める（PLAN D68）
- テスト：`test/e2e/shareJoinGuard.spec.js`（Esc・キャンセル・読み込む・公開し直す）

### M6. 共有: 応答が返らないと、送信が止まったままになる
- 現象：通信に時間制限が無く、応答が返らないと「送信中…」のままになり、以後の変更がすべて後回しになった（閲覧者の画面に結果が出ない）
- 修正：`src/ui/share.js` の `request` に、20秒の時間制限（`AbortController`）を足した。時間切れは「通信エラー」として出し、次の定期の更新（15秒ごと）が通ったあとに自動で送り直す（PLAN D69）
- テスト：`test/e2e/share.spec.js`（応答を返さない状態を作り、時間切れ→通信が戻ると送られる。修正前は「送信中…」のまま失敗することを確認）

### M7. 同じブラウザの2つのタブで、古いタブが新しい変更を上書きする
- 現象：自動保存は、その画面が持っている大会データ全体を書く。2つのタブで開くと、古い内容のままのタブで1つ操作しただけで、もう片方のタブの変更が消えた
- 修正：`src/ui/store.js` に `adoptSaved(raw)` を足し、`src/ui/main.js` で `storage` イベントを受けて、別のタブが保存した内容に合わせる（PLAN D70）。閲覧専用のあいだは取り込まない。取り込んだあとは「元に戻す」の履歴を消す
- テスト：`test/unit/store.test.js`、`test/e2e/multiTab.spec.js`

---

## 2. 未実装の修正（実装案）

### M8. 両方欠席の試合で、欠席者が勝ち上がり、表彰・順位に載る（判断待ち）
- 場所：`src/core/attendance.js:60`（`walkoverInput`）、`src/core/bracket.js:306`（`tournamentRanking`）・`:356`（`tournamentPodium`）
- 現象（再現済み）：1回戦の同じ試合の2人が両方欠席だと、上の枠の不戦勝になる（PLAN D42 の (4) で決めた動き）。その結果、4人の大会で欠席の2人が同じ試合だと、表彰が「優勝 c・準優勝 a（欠席）・3位 b（欠席）と d」になる。2人だけの大会で両方欠席なら、優勝が欠席者になる。総当たりでも、両方欠席の試合は上の枠に勝点が入る
- 案（どれにするかを決める）：
  - 案1（小）：表の動きは変えず、表彰と順位表で、欠席で不戦にした選手（`tournament.walkoverIds`）の名前に「（欠席）」を付けたまま、順位を「—」にする。データの形は変わらない
  - 案2（中）：両方欠席の試合は勝者なし（空き）にして、次の試合の相手を不戦勝で上げる。`result` に `winnerId: null` を許す形になるので、`state.js` の検査・`bracket.js` の `decide`・順位・出力を同時に直す。古いアプリでは、この結果を含むファイルを読めなくなる
  - 案3：今のまま（D42 のとおり。結果入力で直せる）
- おすすめ：案1。データの形を変えずに、掲示物に欠席者が入賞者として出るのを防げる
- テスト：`test/unit/attendance.test.js`（両方欠席の2人が表彰・順位に入賞者として出ない）、`test/unit/export.test.js`（順位表の出力）

### M9. 共有: 運営ログインの失敗の制限が、同時の送信で効かない
- 場所：`worker/src/index.js:347`（`login`）。ロックの確認（`loginLockRemaining`）→ パスワードの照合 → 失敗の記録（`recordLoginFailure`）の順で、確認と記録のあいだに照合がある
- 現象（D1 のシムに遅れを入れて再現。本番の並行性は未確認）：同じ IP から同じ共有へ20件を同時に送ると、20件とも照合される。D59 の「5回までは待たせず、6回目から止める」が、同時の分では守られない。直後の1件は 429 になる
- 直し方：試行を、照合の前に1回の更新で数える。ロック中なら更新されない（0行）ので 429。6回目以降は、同じ更新でロックの終わりを書く
  ```js
  // login(): loginLockRemaining の代わりに
  const t = now(env);
  await env.DB.prepare('INSERT OR IGNORE INTO login_fails (k, n, first_at, lock_until) VALUES (?, 0, ?, 0)').bind(failKey, t).run();
  const row = await env.DB.prepare(`UPDATE login_fails SET
        n = CASE WHEN ?1 - first_at > ?2 THEN 1 ELSE n + 1 END,
        first_at = CASE WHEN ?1 - first_at > ?2 THEN ?1 ELSE first_at END,
        lock_until = CASE WHEN (CASE WHEN ?1 - first_at > ?2 THEN 1 ELSE n + 1 END) > ?3
          THEN ?1 + MIN(?4, ?5 * (1 << ((CASE WHEN ?1 - first_at > ?2 THEN 1 ELSE n + 1 END) - ?3 - 1))) ELSE lock_until END
      WHERE k = ?6 AND lock_until <= ?1 RETURNING n`)
    .bind(t, LOGIN_WINDOW, LOGIN_FREE_TRIES, LOGIN_MAX_WAIT, LOGIN_FIRST_WAIT, failKey).first();
  if (!row) throw new HttpError(429, 'パスワードの間違いが続いたため、しばらく入力できません');
  // 照合。成功なら行を消す（今と同じ）。失敗なら、もう数えてあるので何もしない
  ```
  存在しない共有コードのときは、今と同じく `jn:` の数えを使う（`login_fails` に行を作らない）。待ち時間の残りの表示（「あと約N分」）は、0行のときに `SELECT lock_until` で読む
- テスト：`test/unit/worker.test.js` の同時のテストに「20件同時 → 照合されて 401 になるのは6件まで、残りは 429」「成功すると数えが消える」「期間（LOGIN_WINDOW）を過ぎると数え直す」
- 注意：`1 << n` は SQLite の演算子。D1 と、テスト用の `node:sqlite` の両方で動くことを先に確かめる

### M10. 共有: IPv6 では、IP ごとの制限が1つの回線で効かない
- 場所：`worker/src/index.js:281`（`clientIp`）
- 現象（再現済み）：数えの鍵が IP アドレスそのもの。IPv6 では1つの回線が /64（多数のアドレス）を持つので、アドレスを変えれば、運営ログインの待ち・存在しない共有コードの上限・コメントと報告の上限が効かない
- 直し方：IPv6 は上位64ビットにそろえる
  ```js
  const clientIp = (request) => {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (!ip.includes(':')) return ip;
    const [head, tail = ''] = ip.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
    return `${full.slice(0, 4).map((x) => x.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
  };
  ```
- テスト：`test/unit/worker.test.js`（同じ /64 の7アドレスから失敗させると、6回目から 429。別の /64 は止まらない。IPv4 は今までどおり）
- 注意：鍵が変わるので、デプロイの時点で数えていた IPv6 の分は引き継がれない（害はない）

### M11. トーナメント表で、長い名前が枠からはみ出す
- 場所：`src/render/svg.js:73`（枠の幅は最大 320）・`:100`（`box`。名前の幅を見ずに描く）
- 現象（確認済み）：名前の上限は40文字。全角22文字以上（半角36文字以上）の名前は、枠（320px）より長くなり、隣の線・枠に重なる（画面・PNG とも）
- 直し方：`box` の中で、枠に入る大きさまで字を小さくし（14 → 11px）、それでも入らなければ末尾を「…」にする。CSV・結果一覧は全文のまま
  ```js
  const fitName = (s, bold, maxW) => {
    let size = 14;
    while (size > 11 && measure(s, size, bold) > maxW) size--;
    let out = s;
    while (out && measure(`${out}…`, size, bold) > maxW) out = [...out].slice(0, -1).join('');
    return measure(s, size, bold) <= maxW ? { text: s, size } : { text: `${out}…`, size };
  };
  // box() の中
  const bold = st === 'win' || st === 'champ';
  const f = fitName(name, bold, boxW - 16 - (score !== '' ? measure(score, 13, st === 'win') + 8 : 0));
  if (name) s += text(x + 8, y, f.text, { size: f.size, bold, color, pid });
  ```
- テスト：`test/unit/export.test.js`（40文字の名前で、名前の文字の幅が枠の内側に収まる。CSV には全文が出る）、`test/e2e/bracketView.spec.js`（画面で枠の右端を越えない）

### M12. 過去の大会を見て戻ると、保存に失敗していた入力が消える
- 場所：`src/ui/store.js:110`（`reloadLocal`）
- 現象（経路は確認済み。保存の失敗は容量の超過などで、起きる頻度は低い）：自動保存に失敗した入力は、画面の中だけにある。過去の大会を見る → 戻る、とすると、自動保存の古い内容で置き換わり、入力が消える
- 直し方：戻るときに、自動保存の内容と、見る前の内容（`localBackup`）の新しいほうを使う
  ```js
  const restored = initState();
  if (backup && (!restored || (backup.meta.updatedAt ?? '') > (state.meta.updatedAt ?? ''))) state = backup;
  ```
- テスト：`test/unit/store.test.js`（保存に失敗する状態で入力 → 閲覧 → 戻ると入力が残る。別のタブが新しく保存していれば、それを使う＝今あるテストが通る）

### M13. 結果のカードで、スコアが無い試合の勝者が太字だけで示される
- 場所：`src/ui/resultCards.js:40`
- 現象（確認済み）：スコアを入れずに勝者だけ保存した試合は、スマホのカードで「山田 － 佐藤」と出る。勝者は太字だけで、文字では分からない（読み上げにも出ない）
- 直し方：勝った側に「勝ち」の小さい印を付ける
  ```js
  const player = (name, key) => {
    const won = side === key;
    return `<span class="rc-p${won ? ' rc-win' : ''}"${pidAttr(m[key])}>${nameHtml(name)}${won ? '<span class="rc-mark">勝ち</span>' : ''}</span>`;
  };
  ```
  `web/style.css` に `.rc-mark { font-size: 12px; font-weight: normal; margin-left: 4px; color: var(--sub); }`
- テスト：`test/unit/resultCards.test.js`（勝った側だけに「勝ち」が入る。引き分け・不戦には入らない）

### M14. 回戦のタブが、押すとフォーカスを失う。タブの役割の表記が操作と合わない
- 場所：`src/ui/roundView.js:45`、`src/ui/tournamentView.js`・`src/ui/leagueView.js` の回戦の描き直し（`host.innerHTML = roundViewHtml(...)`）
- 現象（コードで確認。実機は未確認）：タブを Enter で選ぶと、タブごと作り直されてフォーカスが外れる。`role="tablist"`・`role="tab"` を付けているが、矢印キーの操作と tabpanel が無い
- 直し方（小さい案）：`role` を外して `aria-pressed` のボタンにし、描き直しの前後でフォーカスを戻す
  ```js
  const focusKey = host.contains(document.activeElement) ? document.activeElement.dataset.roundTab : null;
  host.innerHTML = roundViewHtml(res, rows, getRoundSel());
  if (focusKey) host.querySelector(`[data-round-tab="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  ```
- テスト：`test/e2e/bracketRounds.spec.js`・`test/e2e/leagueRounds.spec.js`（タブにフォーカスして Enter のあと、同じタブにフォーカスが残る）。`role=tab` を見ている既存のテストを直す

### M15. 引き分けの報告が、トーナメントの試合でも「承認」できるように見える
- 場所：`src/core/report.js:59`（`findOpenMatch`）、`worker/src/index.js:483`（サーバーは試合の種類を知らないので `allowDraw: true`）
- 現象（再現済み）：閲覧者が API へ直接、トーナメントの試合に引き分けを送ると保存される。運営の画面に「承認して表に反映」が出て、押すと「引き分け不可」で失敗し、報告が残る
- 直し方：`findOpenMatch` で止める
  ```js
  if (report.outcome === 'draw' && !hit.allowDraw) return { error: 'この試合は引き分けにできないため、承認できません' };
  ```
- テスト：`test/unit/report.test.js`（トーナメントの試合への引き分けの報告は `reportStatus` が `ok: false`）

### M16. 共有: 報告の「同じ人は同じ試合1回」が、同時の送信で守られない
- 場所：`worker/src/index.js:499` 付近（数えてから書く）
- 現象（D1 のシムで再現）：同じ IP から同じ試合へ3件を同時に送ると、3件とも保存される。影響は、運営の承認待ちに同じ報告が並ぶことだけ
- 直し方：一意の索引で保証する。既にある重複を先に消してから作る
  ```js
  'DELETE FROM reports WHERE id NOT IN (SELECT MIN(id) FROM reports GROUP BY code, match_id, who)',
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_once ON reports (code, match_id, who)',
  ```
  `INSERT` が `UNIQUE constraint failed` で失敗したら 409 にする
- テスト：`test/unit/worker.test.js`（3件同時 → 保存は1件）、`test/unit/worker-index.test.js`（重複のある古い DB を開いても初期化が通る）

### M17. 名前・ファイル名の上限で、絵文字などが途中で切れる
- 場所：`src/core/players.js:17`（`cleanName`）、`src/ui/io.js:24`（`safeFileName`）、`src/core/matchFilter.js:27`
- 現象（再現済み）：「39文字＋😀」を40で切ると、絵文字の前半だけが残る（表示が壊れる）。読込側の `cleanText` は文字単位で切るので、両者が食い違う
- 直し方：`.slice(0, N)` を `[...s].slice(0, N).join('')` に変える（3か所）
- テスト：`test/unit/state.test.js`・`test/unit/matchFilter.test.js`（切った結果の末尾が `/[\uD800-\uDBFF]$/` に一致しない）

### M18. 試合の開始時刻に、存在しない日付（2月30日）を受け入れる
- 場所：`src/core/started.js:7`（`isStartTime`）
- 現象（再現済み）：`isStartTime('2026-02-30T05:30:00Z')` が true。保存ファイルの中の不正な日付を弾けない
- 直し方：日付の部分を作り直して比べる
  ```js
  export const isStartTime = (s) => {
    if (typeof s !== 'string' || !ISO.test(s) || Number.isNaN(Date.parse(s))) return false;
    const date = s.slice(0, 10);
    const d = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
  };
  ```
- テスト：`test/unit/started.test.js`（2026-02-30・2026-04-31 は false、2028-02-29 は true）

### M19. 結果入力・取込のダイアログを Esc で閉じると、入力が確認なしで消える
- 場所：`src/ui/resultDialog.js:121`（キャンセル）、`src/ui/setupView.js` の `setupImport`
- 直し方：`dialog` の `cancel` イベントで、入力があれば確認する
  ```js
  $('result-dialog').addEventListener('cancel', (e) => {
    if (($('rd-s1').value.trim() || $('rd-s2').value.trim()) && !confirm('入力中の結果を破棄しますか？')) e.preventDefault();
  });
  ```
- テスト：`test/e2e/resultSheet.spec.js`（スコアを入れて Esc → 確認でキャンセルすると入力が残る）
- 注意：結果は保存されていないので、データは壊れない。確認が増えるので、要らなければ見送る

### M20. 日本語入力の変換中の Enter で、参加者が追加されることがある（未確認）
- 場所：`src/ui/setupView.js` の参加者の追加フォーム。変換中かどうか（`isComposing`）を見ていない
- 現象：Safari では、変換を確定する Enter がフォームの送信になることがある。Chromium では起きない（未確認。実機で起きるかを先に確かめる）
- 直し方：`keydown` で `e.key === 'Enter' && (e.isComposing || e.keyCode === 229)` のとき `preventDefault`

### M21. トーナメントで結果を保存したあと、フォーカスが試合に戻らない（未確認）
- 場所：`src/ui/tournamentView.js`（総当たりは `leagueView.js` で `restoreFocus` を持つ）
- 直し方：開いた試合の ID を覚え、`result-dialog` の `close` で `g.match[data-id="…"]` へフォーカスを戻す
- テスト：`test/e2e/operability.spec.js`

### M22. トーナメント表の大きさの監視が、描き直すたびに増える
- 場所：`src/ui/bracketView.js:96`（`setupWrap`。描くたびに `new ResizeObserver`）
- 直し方：監視を1つだけ持ち、描き直すたびに `disconnect()` → `observe(wrap)` で付け替える

### M23. 「開始を取り消す」ボタン（卓未定の次の試合）に受け手がない
- 場所：`src/ui/callCard.js:16`（`data-unstart`）。受け手は `src/ui/startMatch.js` の `setupStartButtons`（`data-start` だけ）
- 現象：このボタンは「卓が無い試合」にだけ出る。卓は1つ以上が必須（卓0のデータは読み込めない）なので、今は出ない。押しても何も起きない
- 直し方：ボタンを消す（使われないコード）。残すなら `setupStartButtons` に `[data-unstart]` の受け手を足す

### M24. 表の見出し（th）に scope がない
- 場所：`src/ui/leagueView.js:137`・`:140`、`src/ui/standingsView.js:17`・`:28`
- 直し方：列の見出しに `scope="col"`、行の見出し（`th.rowhead`）に `scope="row"`

### M25. スマホの対戦表のマスの、押せる大きさが決まっていない（未確認）
- 場所：`web/style.css` の `.matrix td.cell`
- 直し方：幅390pxで実際の高さを測り、44px に届かなければ `@media (max-width: 700px) { .matrix td.cell { height: 44px; min-width: 44px; } }`

### M26. 共有: 運営トークンを localStorage に保存している（判断待ち）
- 場所：`src/ui/share.js:64`（`saveCfg`）
- 内容：運営トークン（12時間有効）が localStorage に入る。画面のエスケープに漏れは見つかっていないが、漏れがあると読まれる。sessionStorage に移すと、閉じるたびに運営ログインが要る
- おすすめ：今のまま（当日にブラウザを閉じても続けられることを優先）。変えるなら、運営のトークンだけ sessionStorage にする

### M27. 共有: 本文の大きさを、全部読んでから検査する
- 場所：`worker/src/index.js:240`（`readJson`）
- 直し方：先に `Content-Length` を見て、`maxChars * 4` を超えていれば読まずに 413（1文字は UTF-8 で最大4バイト）

### M28. 保存ファイルの名前に「第N回」が入らない
- 場所：`src/ui/main.js:105`（`saveFile`。`st.meta.title` を直接使っている）
- 直し方：`safeFileName(eventTitle(st) || '大会')` にする。E2E のファイル名の検査を直す

### M29. Windows 版で、保存先を聞かずにダウンロードフォルダへ入る（未確認）
- 場所：`electron/main.cjs`（`will-download` を扱っていない）
- 直し方：`session.defaultSession.on('will-download', …)` で保存のダイアログを出す。実機（Windows）で今の動きを確かめてから決める

### M30. core の関数が、想定外の引数で例外になる
- 場所：`src/core/bracket.js` の `setTournamentResult`（`undefined` を渡すと TypeError）、`generateTournament`・`src/core/league.js` の `generateLeague`（重複した ID を検査しない）
- 現象：画面からは起きない（画面は正しい形で呼ぶ）
- 直し方：先頭で形を検査し、`{ ok: false, error }` か例外を返す

---

## 3. 追加機能の案

採否は PLAN.md「6. 追加機能の検討」に記録してから実装する。既に見送ったもの（通算成績、コメントの返信・通知、ダブルイリミネーション、スイス式、共同編集、PDF、サンプル大会）は入れていない。各案が今のコードに無いことは、検索で確かめた。

### A1. 1試合ごとの予定時刻を出す（高・小）
- 困る場面：参加者が「自分は何時ごろ呼ばれるか」を知りたい。今は「時間帯 2」のような順番しか出ない
- 仕様：「参加者・設定」の大会情報に「1試合の目安（分）」を足す（0＝出さない。初期値 0）。予定時刻＝開始時刻＋（時間帯−1）×目安。試合結果一覧・呼び出し画面・自分の試合・卓の一覧に「約 10:30」と出す。開始時刻が空なら出さない
- データ：`settings.matchMinutes`（整数 0〜240、初期値 0）。古いデータは 0 として読む
- 実装：`src/core/schedule.js` に `slotClock(startTime, slot, minutes)`（純粋関数）。`src/core/state.js` の `defaultSettings`・設定の検査に足す。画面は `setupView.js`（入力欄）と、`callCard.js`・`myMatch.js`・`resultCards.js`・`tableBoardView.js`（表示）
- テスト：`test/unit/schedule.test.js`（繰り上がり・目安 0・開始時刻なし・日をまたぐ）、E2E（呼び出し画面に時刻が出る）

### A2. 次の試合の案内文をコピーする（高・小）
- 困る場面：運営が、部のグループチャットに「次は第3卓で〇〇 対 〇〇」と手で打っている
- 仕様：進行状況の欄と呼び出し画面に「案内文をコピー」を置く。内容は、次の試合（卓・対戦者。A1 があれば予定時刻も）を1行ずつ。コピーできないときは、文を選んだ状態で出す
- データ：足さない
- 実装：`src/core/announce.js` に `announceText(state, kind)`（純粋関数）。コピーは `share.js` の閲覧リンクのコピーと同じ書き方
- テスト：単体（対戦者なし・不戦・卓なし）、E2E（押すと通知が出る）

### A3. 参加者の所属を入れ、1回戦で同じ所属の対戦を避ける（中・中）
- 困る場面：同じ学年・同じ班の人が1回戦で当たり、運営が組み合わせを手で直している
- 仕様：参加者に任意の「所属」（20文字まで）。表の作成のとき、シードの位置を動かさずに、1回戦の同じ所属の組を入れ替えで減らす（減らせないときは今のまま）。作成前の確認画面で、同じ所属の組に印を出す
- データ：`players[].group`（文字列。無ければ所属なし）
- 実装：`src/core/bracket.js` に `avoidSameGroup(slots, groupOf)`（`swapSlots` を使う）。`src/core/players.js` に所属の編集。画面は `setupView.js`（名簿）と `pairingDialog.js`
- テスト：単体（同じ所属の組が減る・シードが動かない・不戦同士を作らない・全員同じ所属なら変えない）

### A4. 受付用の名簿を CSV・印刷で出す（中・小）
- 困る場面：当日の受付で、名簿を紙で見て出欠を確かめたい
- 仕様：「参加者・設定」に「名簿を出力」（CSV／印刷）。列は No.・名前・出欠・チェック欄（A3 があれば所属も）
- データ：足さない
- 実装：`src/core/exportData.js` に `rosterTable(state)`。画面は `exportMenu.js` と同じ出力の仕組み
- テスト：単体（列・欠席の印・BOM・CRLF）

### A5. 総当たりの同率を、運営が順位を決めて確定する（中・小〜中）
- 困る場面：勝点・直接対決・得失点差・総得点まで同じ2人が出ると「同順位」のまま。賞や決勝進出を紙で補っている
- 仕様：順位表の同順位の行に「順位を決める」を出す。入れた順位は、同順位の中だけで効く
- データ：`league.manualRank`（`{ 選手ID: 順位 }`。無ければ今のまま）
- 実装：`src/core/league.js` の `leagueStandings` で、同率のときだけ `manualRank` を見る。画面は `standingsView.js`
- テスト：単体（同率の決定・重複や範囲外の拒否・指定なしなら今のまま）

### A6. 呼び出し画面で、試合が変わったときに音と目印を出す（低・小）
- 仕様：呼び出し画面に「音を鳴らす」のチェック（初期値オフ。チェックを入れた操作のあとだけ鳴らす）。次の試合が変わったら、短い音と枠の強調
- 実装：`src/core/callView.js` に「前回と違うか」の判定。音は `callScreen.js` で `AudioContext`
- 未検証になる点：音そのもの（E2E の対象外）

### A7. 賞状を PNG で出す（低・中）
- 仕様：表彰のカードに「賞状を画像で保存」。1人1枚、大会名（`eventTitle`）・日付・順位・名前
- 実装：`src/render/` に賞状の SVG（今の PNG 出力の仕組みで描ける要素だけを使う）

### A8. 閲覧者に「自分の試合が近い」通知を出す（低・中）
- 仕様：「自分の試合」で名前を選んだ閲覧者に、次の試合が近づいたらブラウザの通知を出す（許可したときだけ）
- 注意：`file://` では通知が使えない。スマホのブラウザは、画面を閉じていると届かない

---

## 4. 採らなかった指摘

- CSV の数式の対策で、`+81` のような名前の先頭に `'` が付く：安全のための仕様（CSV インジェクション対策）。変えない
- 参加者の追加で、同じ名前を止めない：入力チェックに表示し、表の作成で止まる。仕様どおり
- 閲覧中に試合の行を押しても何も起きない：読み取り専用の仕様どおり
