# PBI: 期限切れ local_export_ バッファキーの回収 sweep が恒久 no-op になっている（keyed get の prefix 仮定）を修正する

## ユーザーストーリー

拡張機能の開発者・保守担当者として、ローカル Markdown 自動エクスポートの保持期間 sweep が「動いているように見えるが、実際には何も回収していない」状態を解消してほしい、なぜならこの sweep は VULN-004 で定義した**孤児バッファキーの唯一の回収経路**であり、`chrome.storage.local` の使われ続ける成長が黙って止まったまま、テストが緑であることに気づけないまま本番へ流れ込むから。

もう少し具体的に言えば、ローカル Markdown エクスポートを毎日使い、失敗したダウンロードや `manual` モードの日で残った `local_export_YYYY-MM-DD` キー（その日の Markdown 本文を丸ごと含む）が、設計上の 7 日ウィンドウを永久に超えて蓄積し、後日ユーザーが「保持期間を短くしたのに容量が減らない」と感じる状況を先に防ぐため。

## 優先度

- 順位: 07 / 25
- RICE: 3000（Reach=300 / Impact=1 / Confidence=100% / Effort=0.1）
- 根拠 / 種別: 🔧非機能追加（fix） / 難易度: 🟢低 / 副作用: 🟡軽微

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `local-export-sweep:keyed-get-never-matches-dated-buffer-keys`。監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/（`findings.json` および `NEEDS-VALIDATION.md` 12番）。

### 何が起きているか

`sweepExpiredLocalExportBuffers()` は `chrome.storage.local.get(DAILY_BUFFER_PREFIX)` を呼ぶ（`src/background/dailyPurgeHandler.ts:63`）。`chrome.storage.local.get` の keys 引数に文字列を渡した場合、その意味は**完全一致キーの単一参照**であり、prefix 検索は提供しない。実際に保存されるキーは `local_export_YYYY-MM-DD`（`DAILY_BUFFER_PREFIX` = `'local_export_'` は接頭辞であって実キーではない）なので、本番では毎回 `{}` が返り `expiredKeys` は常に空配列になる。`return 0`（:82）で終わり `chrome.storage.local.remove`（:84）へ到達しない。

### なぜ「テストは緑」なのか

`src/background/__tests__/dailyPurgeHandler.test.ts:44-55` のストレージモックが「文字列引数なら完全一致キー＋その文字列を接頭辞に持つ全キーを返す」という prefix セマンティクスを**捏造**している（コメント: "Chrome returns the exact key plus every key sharing it as a prefix ― the sweep relies on the prefix half of that"）。この捏造があるため、`dailyPurgeHandler.test.ts` の sweep テストは本番の no-op を検出できない。

一方、同じ API を flush 側で正しくモックしている `src/background/__tests__/localMarkdownExportCore.test.ts:95-103` は exact-key セマンティクス（要求されたキーだけ、prefix 分岐なし）で、**同じ `chrome.storage.local.get` に対して2つの矛盾するセマンティクスが同一リポジトリ内に並存している**。加えて `src/background/__tests__/localExportRetention.test.ts:19-35` にも同じ prefix ブランチが複製されている。

### 再発である

本リポジトリ自身の `src/background/localMarkdownExportCore.ts:36-42` に設計ノートが残っている:

> Deliberately no-arg (fetch all of storage): the daily buffer keys this loop looks for (`local_export_YYYY-MM-DD`, DAILY_BUFFER_PREFIX) are dynamic and never enumerated in StorageKeys, so a keyed get() cannot find them ― see 195ff96 (keyed get(), broke this feature entirely) and its revert.

`195ff96`「chrome.storage.local.get の全件取得をキー指定取得に変更」で keyed get が本日付エクスポート機能を丸ごと壊し、あとで revert されている（履歴: `57e26998 docs: no-arg get()が意図的である理由をコメントで明記` で意図が明文化された）。**同じパターンを sweep 側が再導入した**ため、これは再発である。

### 影響の輪郭

- 孤児キー（ダウンロード失敗日、`manual` モード日）の回収経路が**恒久的に死んでいる**。キーには当日の Markdown エントリ（`MAX_DAILY_BUFFER_ENTRIES` = 2000件/日上限）が含まれるため、蓄積はキー数だけの話ではない。
- `src/background/dailyPurgeHandler.ts:160` のログは `swept > 0` のときしか出ないため、**no-op の状態ではログにも現れない**（静かなまま）。
- フィルタ本体（`BUFFER_DATE_PATTERN`・今日/昨日除外・cutoff 境界、:73-80）は正しく書かれているが、入力が空なので一度も実行されない。つまり**フィルタの仕様は正しい。壊れているのは取得の第一段だけ**。

## BDD受け入れシナリオ

```gherkin
Scenario: 期限切れのバッファキーは sweep 実行後に削除される
  Given ストレージに local_export_<保持期間より古い日> が 1 件と、
        local_export_<保持期間内>・local_export_<昨日>・local_export_<今日> がそれぞれ 1 件入っている
  When 日次パージが走る（handleDailyPurgeAlarm → sweepExpiredLocalExportBuffers）
  Then 期限切れのキーだけが存在しなくなり
  And chrome.storage.local.remove が削除対象キー配列を引数に 1 回呼ばれる
  And sweepExpiredLocalExportBuffers が削除件数を返す

Scenario: 今日・昨日・窓内・日付形式でないキー・prefix 外のキーは削除されない
  Given ストレージに以下が同時に入っている
        local_export_<今日> / local_export_<昨日> / local_export_<保持期間内> /
        local_export_<期限切れ日>corrupt / 'local_export_' 単独 / 'unrelated_key'
  When sweepExpiredLocalExportBuffers を実行する
  Then 削除されるのは日付形式かつ保持期間条件を満たすキーだけである
  And 今日・昨日・窓内のキーは flush 自身のスケジュールで持ちうるため必ず残る
  And 日付として解釈できないキーと prefix 外のキーは無傷で残る

Scenario: 回帰ガード ― プラットフォーム契約に忠実な exact-key モックでも green になる
  Given ストレージモックは chrome.storage.local.get のプラットフォーム契約どおりに振る舞う
        （文字列引数 = 完全一致キーの単一参照、prefix 一致は返さない）
        つまり localMarkdownExportCore.test.ts:95-103 と同じセマンティクスであり、
        日付付きキーを前方一致で引き寄せるような捏造がない
  And 期限切れの local_export_ キーが 1 件だけシードされている
  When sweepExpiredLocalExportBuffers を実行する
  Then remove が呼ばれ、そのキーは回収される
  # 注意: 現行実装（keyed get 前提）ではこのシナリオは RED になる。
  # これが本 PBI の存在意義であり、GREEN へ変えることが受入基準。
```

## 受け入れ基準

- [x] `sweepExpiredLocalExportBuffers` が prefix 検索を前提にせず、`local_export_YYYY-MM-DD` 形式のキーを実際に列挙して判定する取得方法へ変更されている（`src/background/dailyPurgeHandler.ts:63`）
- [x] 上記 BDD Scenario 1（期限切れキーの削除と `remove` 呼び出し）が自動テストとして実装されパスしている
- [x] 上記 BDD Scenario 2（今日/昨日/窓内/不正形式/prefix 外は保持）が自動テストとして実装されパスしている
- [x] `src/background/__tests__/dailyPurgeHandler.test.ts:44-55` の prefix セマンティクスを捏造しているモックが撤廃され、プラットフォーム契約に忠実な exact-key セマンティクス（prefix 分岐なし）に置き換わっている
- [x] 同じ prefix 分岐が `src/background/__tests__/localExportRetention.test.ts:19-35` にも存在するため、共有か同契約への修正かが決まり、リポジトリ内で一貫している
- [x] `src/background/dailyPurgeHandler.ts:159-162` の呼び出し・ログ経路が新しい取得方法でも従来どおり 1 日 1 回実行され、削除が発生したときは `local-export buffer sweep completed` が記録される
- [x] 本 PBI の実装で Chrome 実機の取得量が無制限に膨らまないことが確認されている（no-arg get は当日 1 回のみで、flush 経路が既に使っている読み方であることをコメントで明示）
- [x] `npm run validate`（型チェック + テスト）が緑

## テスト戦略

### 単体

`src/background/__tests__/dailyPurgeHandler.test.ts` の捏造 prefix モック（:44-55）を、正確な exact-key モックに置き換える。そのうえで BDD Scenario 1/2 を pin し、**「sweep が `chrome.storage.local.remove` を呼ぶ」こと**を明示的に assert する（現状のテストは事後のストレージ状態だけを見ており、`remove` 呼び出し自体を spy していないため、取得が `{}` になっても同じ状態検査をすり抜ける）。

`testDir/mocks/` に「プラットフォーム契約に忠実な `chrome.storage.local` モック」を 1 本化し、`localMarkdownExportCore.test.ts:95-103` と `localExportRetention.test.ts:19-35` から同じセマンティクスを共有参照させる。ただし本 PBI のスコープでは「少なくとも `dailyPurgeHandler` 側を契約忠実化する」ことを目標にし、共有化は任意の stretch とする（テスト構造の過度な作り替えを避ける）。

### 統合

flush 側 `src/background/__tests__/localMarkdownExportCore.test.ts` の exact-key モックと共通化したうえで、「孤児キーが 1 つある状態で flush が成功すると `remove` で回収され、その翌日に sweep は何もしない」という通しを確認する。実質的におおむね上記 BDD Scenario 1 がカバーする。既存 `localExportRetention.test.ts` のダウンロード記録保持（29/30/31 日）テストは壊さない。

### E2E

実プロファイル観測（owner観測・ライブターゲットへの probe ではない）: 隔離 Chromium プロファイルに unpacked 拡張を読み込み、期限切れの `local_export_YYYY-MM-DD` キーを 1 件シード → 日次パージを 1 回強制実行 → `chrome.storage.local` にそのキーが残っているか観測する。残っていれば修正前、消失していれば修正後という観測で、修正の効果を確かめる。

## 実装メモ（実装者向け）

### 対象ファイルと該当行

| ファイル | 行 | 役割 |
|---|---:|---|
| `src/background/dailyPurgeHandler.ts` | 63 | 破損点。`get(DAILY_BUFFER_PREFIX)` ― prefix 仮定の keyed get |
| `src/background/dailyPurgeHandler.ts` | 73-80 | フィルタ本体（正しい仕様だが入力が空で未実行） |
| `src/background/dailyPurgeHandler.ts` | 82-85 | `return 0` で短絡 / `remove` への到達不能点 |
| `src/background/dailyPurgeHandler.ts` | 48 | 「唯一の回収経路」だという前提で書かれた doc コメント |
| `src/background/dailyPurgeHandler.ts` | 159-162 | 呼び出し側 + `swept > 0` のみログ |
| `src/background/localMarkdownExportCore.ts` | 36-42 | no-arg get を採用した設計ノート（195ff96 と revert の記録） |
| `src/background/pipeline/steps/saveLocalMarkdownStep.ts` | 22 | `DAILY_BUFFER_PREFIX = 'local_export_'`（接頭辞であって実キーではない） |
| `src/background/pipeline/buffers/MarkdownBufferManager.ts` | 13, 48 | 書き手。`${prefix}${YYYY-MM-DD}` でキーを生成 |
| `src/background/__tests__/dailyPurgeHandler.test.ts` | 44-55 | **捏造された prefix モック（要置換）** |
| `src/background/__tests__/localMarkdownExportCore.test.ts` | 95-103 | 正確な exact-key モック（共有化先） |
| `src/background/__tests__/localExportRetention.test.ts` | 19-35 | prefix モックが 2 つ目に複製されている |

### 最小変更の選択肢

**選択肢 1（推奨・最小差分）**: `src/background/dailyPurgeHandler.ts:63` の取得を no-arg / null に切り替え、既存のフィルタに接頭辞ガードを 1 行足す。flush 側（`localMarkdownExportCore.ts:42`）と同じ解決で、フィルタ本体の仕様は 1 文字も変えない。

- `const stored = await chrome.storage.local.get();`（または `get(null)`）
- フィルタ冒頭で `if (!key.startsWith(DAILY_BUFFER_PREFIX)) return false;`（現状は `key.slice(DAILY_BUFFER_PREFIX.length)` を無条件に行うため、接頭辞以外のキーでは日付パターンがまず通らないが、明示的なガードの方が「列挙対象 = `local_export_` キー」という不変条件を読者に対して表明できる）

**選択肢 2**: `chrome.storage.local.get(null)` の戻りから `local_export_` で始まるキーを明示的に選び出してから remove する。選択肢 1 と同じ読みだが、flush ループ（`localMarkdownExportCore.ts:44-45`）との重複をそのまま受け入れる形。daily buffer キー列挙用の小さなヘルパ（例: `listDailyBufferKeys(all)`）に切り出して flush 側と共有すれば「prefix 契約の定義が 1 箇所に増える」ため再発は減るが、本 PBI の Effort=0.1 ではスコープ拡大になる。共有化は follow-up 候補として記録する。

いずれも読み取り量の上限について: no-arg get は当日 1 回（日次アラーム）であり、`flushBufferedExports` はすでに同じ読み方をしている。`unlimitedStorage` は付与済みで、本文サイズの上限は `MAX_DAILY_BUFFER_ENTRIES` と retention 側で既に制御されている。195ff96 の動機だった「メモリ圧迫」に対して、**日次 1 回の読みでは実質リスクなし**であることを実装コメントに残すこと（195ff96 の教訓を誤読させないため）。

### テストモックのセマンティクスを platform 契約に合わせる（必須）

本 PBI の中核は**「テストが誤ったモックのまま green で、Wrong な実装を緑に保ったまま」だった状況の解消**である。実装だけで終わらせない:

- `dailyPurgeHandler.test.ts` の prefix ブランチを削除し、`localMarkdownExportCore.test.ts:95-103` と同じ exact-key セマンティクスにそろえる。**prefix 分岐を残したまま新しい取得方法に書き換えると、「取得側を直した」のか「モックが prefix を捏造していたのを庇った」のか区別できなくなる。**
- モックのコメント「Chrome returns the exact key plus every key sharing it as a prefix」はプラットフォーム API の契約として誤りであることを、テストコード内のコメントで明示的に否定する。理由を書いておかないと次の実装者が同じ誤りを再導入する（この再発は 195ff96 → 再導入で既に 1 度起きている）。
- `localExportRetention.test.ts:19-35` にも同じブランチが複製されている。sweep 側のテストを緑にしても、これが使える限り「prefix モックが正しい」という誤った前提がリポジトリ内に残る。少なくとも同一のコメント注記を付けるか、共有モックへ寄せる。
- **新しい guard テスト**: 「exact-key モックを差し込んだ状態で現行の keyed get 実装は必ず RED になる」を一度だけ確認し、その RED を記録として残す。これが BDD Scenario 3 である。

### 着手前に潰すべき検証（ブロッカー）

本件は needs_validation 判定であり、ソースのみでは 2 点が未決である。実装に入る前に潰すこと（潰さずに実装には進まない）:

1. **プラットフォーム実挙動の観測**: 隔離 Chromium プロファイルで `chrome.storage.local.get('local_export_')` を実行し、`local_export_YYYY-MM-DD` キーを含むストレージに対して `{}` が返ることを実際に見る。API 契約とリポジトリ自身の 195ff96 の記録はいずれも exact-key を支持しているが、本番 API 実挙動は source-only run では観測できていない。
2. **どちらのテストモックがプラットフォームに忠実かの owner 判断**: exact-key モック（`localMarkdownExportCore.test.ts:95-103`）と prefix 捏造モック（`dailyPurgeHandler.test.ts:44-55`）のどちらが正しいかの判断。判断結果は本 PBI と `pbi/00-INDEX.md` の完了記録に残すこと（「どちらを正しいと判断したか」が残らないと、次に誰かが両方を「効率のため」に統合しようとして混線する）。

観測が「exact-key ではない」と判明した場合（稀だが、API 仕様が変わっている可能性は理論上残る）、本 PBI の修正方向は選択肢 1/2 のままでよいが、テストモックの置換方針と「platform 契約に忠実」を明記する箇所が書き換わる。実装に条件分岐を持たせるとレビューが曖昧になるため、観測結果を先に確定させることを推奨。

### ログの可観測性（任意・非ブロッカー）

現在 `swept > 0` のときしかログが出ないため、no-op の状態はログ上でも不可視である。取得はできたが対象なし（`swept === 0`）ケースと、取得結果が空だったケースを区別するログを検討してもよいが、本 PBI の受け入れ基準には含めない（スコープ拡大を避ける）。修正後は「sweep が黙ったままではなく実際に削除件数を返す」ようになった時点で、別途ログ改善 PBI を起票する判断でよい。

### ロールバック手順

- 本変更はローカル Markdown の**削除処理を増やす**ため、ロールバック時に不整合が起きうる。
- 変更を 1 コミットに切り出す（`dailyPurgeHandler.ts` の取得行 + `dailyPurgeHandler.test.ts` のモック + （共有化した場合）モック 1 本のみ）。他ファイルが混ざらないことをコミット前に確認する。
- `git revert <commit>` で戻せるようにしておく。戻すとコードは「no-op だがテストも緑」な元に戻り、本番の孤児キー蓄積が再開する（データ損失ではなく容量再開なので緊急度は低いが、無言で戻すことになるので理由を記録する）。
- Rollback 後、**既に削除された local_export_ キーは復元できない**（復活経路は同日内の未フラッシュエントリのみ）。したがって Rollback の判断材料は「テストが壊れた」ではなく「保存不可データが消える」一点に絞る。上記テスト変更はモック差し替えのみなので、`remove` の対象キー判定自体を revert しない限り本番データは影響を受けない。
- 本番ではなく dev プロファイルでの Rollback 観測を優先する。データが失われるのは Wrong な条件下のロールバックのみ。

## 見積もり

1pt 🟢（取得 1 行 + フィルタ 1 行の差し替えと、テストモックのセマンティクス差し替えのみ。設計判断は flush 側が既に同じ解決を採用済みで前例がある）

## Definition of Done

- [x] BDDシナリオが自動テストで実装されパス（誤ったモックの据置なし）
- [x] `npm run validate` が緑
- [x] 監査 fingerprint `local-export-sweep:keyed-get-never-matches-dated-buffer-keys` を完了記録に残す
- [x] コードレビュー完了
- [x] ドキュメント更新済み

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所再現 + 仕様確定）
- 決め手: exact-key セマンティクスのモックで期限切れ `local_export_2020-01-01` を seed しても **返り値 0・remove 未呼び出し**（恒久 no-op）。捏造 prefix モックでは 1 件回収され、**同一 API に矛盾する 2 モックが並存**していることも確認。`chrome.storage.local.get` の文字列引数は exact-key 単一参照で、prefix マッチは API に存在しない（Chrome docs）
- 影響: 捏造 prefix モックが API 契約違反であることが一次情報で確定。修正選択肢に `getKeys()`（Chrome 130+）を追加できる

## 関連

- pbi/00-INDEX.md
- VULN-004 系: `src/background/localMarkdownExportRetention.ts`（`LOCAL_MARKDOWN_BUFFER_RETENTION_DAYS = 7`、`MAX_DAILY_BUFFER_ENTRIES = 2000`）
- 参考コミット: `195ff96`（keyed get で本日付エクスポート機能を破壊）/ `57e26998`（no-arg get の意図を明文化）
- 監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/（`findings.json`, `NEEDS-VALIDATION.md` 12番）

## 完了記録（2026-10-20）

- 実装: 破損点 `get(DAILY_BUFFER_PREFIX)` を no-arg `get()` に変更し、フィルタ冒頭に `startsWith(DAILY_BUFFER_PREFIX)` ガードを追加（PBI 選択肢 1・最小差分、フィルタ本体は無変更）。`chrome.storage.local.get` に prefix モードは存在しない（文字列引数は exact-key 単一参照）ことを受入基準どおり明記。
- モック修正: `dailyPurgeHandler.test.ts` と `localExportRetention.test.ts` に複製されていた捏造 prefix モック（`startsWith(keys)` ブランチ）を exact-key セマンティクスへ統一し、API 契約違反をテストコード内の否定コメントで明示（195ff96 の再発防止注記付き）。共有化（testDir/mocks 1 本化）は受入基準 5 どおり任意のまま見送り。
- 検証: Red 確認（exact-key モック差し替え直後・実装修正前 = 5 failed / 6 passed で恒久 no-op を検出）→ Green 転換 / 対象 3 ファイル 35 テスト緑（--repeats=5 でも 25/25）/ type-check / eslint / graphify 済み。BDD Scenario 1/2 を pin、既存テストの期待値は 0 変更。
