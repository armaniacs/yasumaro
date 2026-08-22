# PBI: diagnosticsPanel の深掘り — 全セクションを DiagnosticsCollector の collect() に集約

## ユーザーストーリー
開発者として、682行の diagnosticsPanel を「collect() → DiagnosticsSnapshot → render(Snapshot)」の1 seam に再構成したい、なぜならデータ収集（getSettings + キャスト20件）、整形（makeStatRow 約30件）、破壊的操作（migrate/backfill/cleanup）が1クロージャに混在し、DiagnosticsCollector が存在するのに迂回されて「システム状態の正解」が2つある状態だから

## 優先度
- 順位: 2 / 4（pass 2）
- RICEスコア: 160（Reach=150 / Impact=2 / Confidence=80% / Effort=1.5人週）
- 根拠: 診断パネル利用者 + Wave 2 lifecycle 移行で最近触られたホットファイル。Impact 2（二重の真実源の解消）。Confidence 80%（既存 collector の拡張であり新規 seam ではない）。Effort 1.5週。PBI 03（SettingsRepository採用）がこのファイルを最大のキャスト群として狙うため、本 PBI を先に完了させると後続の作業量が減る

## BDD受け入れシナリオ

```gherkin
Scenario: collect() が全セクションのデータを返す
  Given DiagnosticsCollector.collect() が DiagnosticsSnapshot を返す
  When パネルが load を実行する
  Then storage / extInfo / obsidian設定 / AI設定 / connection結果 / sqlite統計 / deficiency / builtInAI / compile options / divergence の全セクションデータが Snapshot から供給される

Scenario: パネルは DOM を直接読まない
  Given diagnosticsPanel が render-only に再構成されている
  When loadAndPopulate 相当の処理が走る
  Then chrome.storage.local.get('debugMode') や getSettings() をパネル本体が呼ばず、Snapshot 経由で debugMode を受け取る

Scenario: Snapshot 断言でテストできる
  Given InMemory adapter を注入した DiagnosticsCollector がある
  When collect() を呼ぶ
  Then makeStatRow や querySelector に触れず、Snapshot のフィールド値だけで各セクションの正しさを断言できる

Scenario: 破壊的操作は action handler 経由で確認ダイアログ付き
  Given ユーザーが migrateLogs / backfillMetadata / cleanupLegacyStorage のボタンを押す
  When action handler が confirmDialog を表示して承認される
  Then サービス呼び出し後に Snapshot を再収集して該当セクションのみ再描画する

Scenario: エラー — 収集の一部が失敗しても他セクションは描画される
  Given SQLite status の取得がタイムアウトする
  When collect() がセクションごとにエラーを捕捉する
  Then 失敗セクションは error ステータスを持ち、残りセクションは正常描画される
```

## 受け入れ基準
- [x] `diagnosticsPanel.ts` が400行未満になり、`getSettings` / `chrome.storage.local.get` を直接呼ばない（import しない）
- [x] `DiagnosticsSnapshot` 型に全セクション（storage/extInfo/obsidian/ai/connection/sqlite/deficiency/builtInAI/compileOptions/divergence）のフィールドが定義され、`collect(): Promise<DiagnosticsSnapshot>` が単一エントリポイントになる
- [x] `renderBuiltInAiStatus` を含む整形関数がパネル側に残り、Snapshot を入力として純粋描画する
- [x] 既存の lifecycle テスト（Wave 2 追加分19件）が Snapshot ベースに移行され、DOM querySelector 断言が Snapshot 断言に置換される
- [x] migrate/backfill/cleanup ボタンの confirm dialog 挙動とエラー表示が現行どおり維持される
- [x] `npm run type-check` / `npm test` がパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ダッシュボード診断パネルを開き、全セクションが描画され、debugMode で compile options セクションが出現するシナリオ

### 統合テスト
- DiagnosticsCollector + InMemory adapter で collect() → Snapshot 全フィールドの統合テスト（settings/sqlite mock 応答との対応）
- action handler: confirm 承認 → dashboardSqliteService 呼び出し → 再収集の統合テスト

### 単体テスト
- render 関数群（makeStatRow 入力 → DOM 出力）の境界値（空文字/null/undefined フィールド）
- セクション別エラー捕捉（1セクション throw で他が生きること）

## 見積もり
3pt（要チームでの見積もり）— 全面移植だが型（Snapshot）で導かれる機械的移動。既存 lifecycle テストの書き換えが主コスト
- **確認**: diagnosticsPanel.ts は 682行、DiagnosticsCollector.ts は 146行（underused）

## 技術的考慮事項
- 依存関係: なし。ただし PBI 03（SettingsRepository 採用）は本 PBI 完了後に着手すると diagnosticsPanel 分のキャスト撤去作業が不要になる
- テスタビリティ: collector には InMemory adapter（dashboardSqliteService の fake + settings fake）を注入。DOM は jsdom でレンダー検証のみ
- 非機能要件: i18n メッセージキーの変更なし。描画される文言・ラベル・severity 表示は現行と同一

## 実装者向け注記

### 現状コードの確認
```bash
# 3責務の混在と迂回の実態
grep -c "as string\|as number\|as boolean" src/dashboard/panels/diagnostic/diagnosticsPanel.ts   # ~20 casts
grep -n "querySelector" src/dashboard/panels/diagnostic/diagnosticsPanel.ts | wc -l              # 12 selectors
grep -n "getSettings\|chrome.storage.local" src/dashboard/panels/diagnostic/diagnosticsPanel.ts
wc -l src/dashboard/panels/diagnostic/DiagnosticsCollector.ts                                     # 146 lines (underused)
# 現行の lifecycle テスト
ls src/dashboard/panels/diagnostic/__tests__/
```

### 実装手順
1. `DiagnosticsSnapshot` 型を定義し、まず builtInAI セクション（既に collector 経由の部分）を Snapshot フィールドへ寄せて形を確定させる
2. obsidian/AI設定セクション（getSettings + キャスト群）を collector 内の private 収集関数に移植。デフォルト値（'https', '27124' 等）も collector 側へ
3. sqlite 統計・deficiency・compile options・divergence セクションを順次移植（1セクションごとに type-check + 既存テスト実行）
4. debugMode 取得を collector へ移動し、パネルから `chrome.storage.local.get` を除去
5. パネルを render(Snapshot) + action handlers（confirm → service → re-collect）に縮小
6. Wave 2 の lifecycle テスト19件を Snapshot 断言ベースに書き換え、render の DOM テストは最小限（セクション存在確認程度）に縮小
7. `npm run validate` で全体確認

### 落とし穴
- `renderBuiltInAiStatus` は export 関数として外部（download 完了後の refresh）から呼ばれる。シグネチャを Snapshot の該当セクション型に変える際、呼び出し元の再描画フローを壊さないこと
- AI設定セクションは priority list 空時の legacy AI_PROVIDER フォールバックがある。この判定ロジックは収集責務なので collector 側に置く（描画側にフォールバック知識を残さない）
- connectionResult セクションは前回テスト結果の保持（ロード時に常に空ではない）可能性があるため、Snapshot が stateful 側面を持たないよう「直近テスト結果」フィールドの扱いを実装前に確認すること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす（collector のセクション別エラー分岐）
- [x] コードレビュー完了
- [x] リファクタリング完了（パネル400行未満、収集の panel 直呼び出しゼロ）
- [x] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md の diagnostics 記述を Snapshot 構造に更新）
