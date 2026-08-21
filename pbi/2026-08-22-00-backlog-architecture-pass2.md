# Backlog: アーキテクチャ深掘り pass 2 — 4件の RICE 優先度付けと疑問の自律解決

## 候補一覧（フェーズ0: 列挙）

アーキテクチャレビュー pass 2（`architecture-review-20260821-214715.html`）で発見した4件。pass 1 の5件（2026-08-21-01〜05）とは対象モジュールが重複しないため、そのまま独立候補として扱う。

| # | 候補 | 概要 |
|---|------|------|
| A | diagnosticsPanel 深掘り | 682行のパネルが収集・整形・破壊的操作を1クロージャで担当。DiagnosticsCollector が存在するのに迂回されている |
| B | MigrationService 分割 | 565行に4種のジョブ（legacy移行/backfill/cleanup/OPFS復旧）+ 手作り状態マシン（6対のstorage accessor） |
| C | SettingsRepository 採用 | deep module が存在するのにパネルは生 getSettings + キャスト + インラインデフォルトで読む |
| D | AI 接続テスト protocol 抽出 | TEST_AI進捗の listener + 改造メッセージガード + runId相関が generalSettings 専用モジュールに閉じ込め済み |

重複なし。A と C は diagnosticsPanel で交差するため依存順を付けた。

---

## 優先度付け（フェーズ2: RICE）

### スコア表

| 順位 | 候補 | Reach | Impact | Confidence | Effort | RICE | 根拠 |
|------|------|-------|--------|------------|--------|------|------|
| 1 | B: MigrationService 分割 | 200 | 2 | 80% | 1.5人週 | **213** | 全ユーザーが起動時マイグレーション経由で通過。Impact 2（god module + 隠れた状態マシン、retry/give-up が chrome mock なしでテスト不能）。Confidence 80%（QueueStorageAdapter の先行パターンあり、消費者2箇所のみ）。Effort 1.5週 |
| 2 | A: diagnosticsPanel 深掘り | 150 | 2 | 80% | 1.5人週 | **160** | 診断パネル利用者 + Wave 2 で最近触られたホットファイル。Impact 2（「システム状態」の正解が2つある状態）。Confidence 80%（collector 拡張は既存 seam の深化）。Effort 1.5週 |
| 3 | C: SettingsRepository 採用 | 300 | 1 | 80% | 2人週 | **120** | 設定を読む全パネル。Impact 1（振る舞い変化なし、型安全化と defaults の局在化）。Confidence 80%（getMany 追加が必要な可能性）。Effort 2週。A 完了後に着手（最大キャスト群が消えるため） |
| 4 | D: AI progress client 抽出 | 20 | 0.5 | 50% | 0.5人週 | **10** | 現消費者1件のみ。deletion test 不合格（1 adapter = hypothetical seam）。2つ目のUI面が出現したときに再評価 |

### 依存関係の確認
- B → 依存なし（deferredMigrations / dashboardSqliteWiring の2 import 先のみ）
- A → 依存なし。ただし A 完了後に C をやると diagnosticsPanel の20キャストが既になくなり、C の作業量が減る
- C → A に暗黙依存（推奨順序、必須ではない）
- D → 保留条件付き（第2消費者の出现がトリガー）

### 最終順位

| NN | PBI ファイル | 候補 | RICE | 依存 |
|----|--------------|------|------|------|
| 01 | `pbi/2026-08-22-01-refactor-migration-service-split.md` | B | 213 | なし |
| 02 | `pbi/2026-08-22-02-refactor-diagnostics-panel-deepening.md` | A | 160 | なし |
| 03 | `pbi/2026-08-22-03-refactor-settings-repository-adoption.md` | C | 120 | 02完了後推奨 |
| 04 | `pbi/2026-08-22-04-backlog-ai-test-progress-client.md` | D | 10 | 保留（第2消費者待ち） |

同点なし。全体バックログとしては 2026-08-21 波（RICE 1200〜12.5）が先、本波が後。

---

## 疑問の解決（フェーズ3: なぜなぜ分析）

### 疑問1: 「MigrationService はなぜ4ジョブも抱えたまま素通りされてきたのか？分割して本当に壊れないか？」

**なぜ1:** なぜ4ジョブが1クラスに集まったのか → すべて「legacy chrome.storage データと SQLite の間の何か」という漠然とした括りで追加された
**なぜ2:** なぜ漠然とした括りのままでよしとされたのか → 各ジョブの追加時点では他ジョブとの共有は storage accessor 6個だけで、重複が小さく見えた
**なぜ3:** なぜ accessor 共有だけが共有だと見なされたのか → 状態マシン（status/progress/retryCount）が private メソッドの中に隠れ、「共有している実体」に見えなかった
**なぜ4:** なぜ隠れたのか → chrome.storage 直呼び出しが25箇所に散り、どの呼び出しが状態マシンの一部かを grep で追うのが困難
**なぜ5:** なぜ grep で追えない構造になったのか → 永続化 port が抽象化されず、adapter パターン（PersistentRetryQueue/QueueStorageAdapter ですでに実績あり）が適用されてこなかったから

**解:** LegacyMigration と OpfsRecovery に分割し、status/progress/retry の状態マシンを QueueStorageAdapter 型の storage port の背後に置く。mapLegacyEntryToRecord は純粋関数として共有。これで「壊れる」リスクは import 先2箇所の更新に限定され、InMemory adapter で retry/give-up が初めて単体テスト可能になる。

### 疑問2: 「DiagnosticsCollector があるのに、なぜパネルは使わないのか？」

**なぜ1:** なぜ collector を迂回するのか → collector の Snapshot は11診断の一部しかカバーせず、残り（Obsidian/AI設定表示、compile options、divergence warning）は最初からパネル側に書かれた
**なぜ2:** なぜ一部だけだったのか → Wave 2 の lifecycle 移行時に collector は「既存ロジックの抽出」ではなく「新規診断の受け皿」として作られ、既存セクションの移植は範囲外だった
**なぜ3:** なぜ範囲外だったのか → 682行の全面移植は1 PBI を超えると判断され、lifecycle 化だけを先に完了させた
**なぜ4:** なぜその判断が放置されたのか → 「動いているものを触らない」で移植の後回しが正当化され、フォローアップ PBI が立っていなかった
**なぜ5:** なぜフォローアップが立たなかったのか → DOM 断片（querySelector ×12）と収集ロジックが密着し、「どこからが収集でどこからが描画か」の切り口が誰にも定義されていなかったから

**解:** 切り口を collect() → DiagnosticsSnapshot（データのみ）と render(Snapshot)（DOM のみ）で明示定義し、全セクションを Snapshot 側へ移す。破壊的操作（migrate/backfill/cleanup）は confirm dialog 込みで action handler 層に分離。これで collector への統合が「全面移植」ではなく「型で導かれる機械的移動」になる。

### 疑問3: 「SettingsRepository が『完成』と言われた波があるのに、なぜ誰にも採用されていないのか？」

**なぜ1:** なぜ未採用なのか → repository は get/getAll/set/setAll/onChange のみで、パネルが必要な「複数キーの一括読み取り＋デフォルト適用」の形と合っていなかった
**なぜ2:** なぜ形が合わなかったのか → パネル側の実際のコードは `getSettings()` を1回呼んでオブジェクトから20キー引く形であり、repository の per-key get に置き換えると呼び出しが増える
**なぜ3:** なぜ増える形で設計されたのか → per-key get は InMemory adapter テストには最適だが、呼び出し側の人間工学的コストが評価されていなかった
**なぜ4:** なぜ評価されなかったのか → 第2波の SettingsRepository PBI の受け入れ基準が「seam の存在」までで「採用」まで含んでいなかった
**なぜ5:** なぜ含まれていなかったのか → deep module の価値（interface の小ささ）だけが測定対象で、leverage（呼び出し側がどれだけ楽になるか）が基準に入っていなかったから

**解:** getMany(keys) を追加し「1回の呼び出しで複数キーを型付き取得」できる形状にする。diagnosticsPanel（最大キャスト群）から移行を開始し、受け入れ基準に「対象パネルでの生キャスト0件」を入れる。

---

## PBI 出力（フェーズ4–5）

| 順位 | ファイル | 候補 | ストーリーポイント |
|------|----------|------|-------------------|
| 1 | `pbi/2026-08-22-01-refactor-migration-service-split.md` | B: MigrationService 分割 | 3pt |
| 2 | `pbi/2026-08-22-02-refactor-diagnostics-panel-deepening.md` | A: diagnosticsPanel 深掘り | 3pt |
| 3 | `pbi/2026-08-22-03-refactor-settings-repository-adoption.md` | C: SettingsRepository 採用 | 3pt |
| 4 | `pbi/2026-08-22-04-backlog-ai-test-progress-client.md` | D: AI progress client 抽出 | 1pt（backlog・保留） |

### 依存関係サマリ
- 必須依存なし。推奨: 01 → 02 → 03（02完了後に03をやると作業量が減る）→ 04は第2消費者出现時
- 全体順序: 2026-08-21 波（RICE 1200〜12.5）→ 本波（213〜10）
