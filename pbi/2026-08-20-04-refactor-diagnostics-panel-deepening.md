# PBI: Diagnostics Panel の深深化 — 681行 god module を DiagnosticsCollector に分解

## ユーザーストーリー
開発者として、`src/dashboard/panels/diagnostic/diagnosticsPanel.ts`（681行）が11の診断セクション（storageStats / extInfo / obsidianSettings / aiSettings / sqliteStats / deficiencyStats / builtInAiStats / compileOptions + 3つのアクション行）の全てのクエリ・レンダリング・エラーハンドリングを1ファイルに抱えている状態を解消したい。なぜなら、新しい診断項目を追加するたびに `querySelector → innerHTML → makeStatRow → error handling` の6行パターンをコピペする必要があり、テストするには完全な DOM + `chrome.storage` + `getSqliteStatus` の全てをモックする必要があるからだ。

## 優先度
- 順位: 04 / 5
- RICEスコア: (Reach=4 × Impact=2 × Confidence=0.8) / Effort=3 = 2.1
- 根拠: Reach 4（diagnostics パネルは開発者・サポート用途で、一般ユーザーの日常利用では開かれない。`chrome://extensions` の詳細確認や不具合報告時にのみ参照される）。Impact 2（診断の追加コストが 1/5 になり、エラーハンドリングの不整合が1箇所に集約される。11セクションの表示ロジックが1つの snapshot 型で型安全になる）。Confidence 80%（パターンは明確 — 各セクションは `query → makeStatRow` の繰り返しであり、収集と描画の分離は自明。local-substitutable な fake でテスト可能）。Effort 3人日（DiagnosticsCollector の抽出 + snapshot 型定義 + renderer の分離 + 11セクションのテスト移行）。03と並列着手可能だが、03の transport パターンが先に固まると collector の SQLite 取得部分で再利用できるため03の後に着手する方が効率的。

## ビジネス価値
- 保守性: 診断項目の追加が `DiagnosticsCollector` の1メソッド追加 + `snapshot` 型への1フィールド追加で完結する（従来は panel ファイルの imperative な DOM 操作を6行コピペ）。
- 品質: snapshot が型安全になるため、フィールド名の typo がコンパイルエラーになる。現在は `querySelector('#diag...')` の文字列 typo が silent fail する。
- 測定方法: 新しい診断項目（例: `diagLastSyncTime`）を追加する所要行数が 15行 → 3行に削減されることを計測。既存11セクションの表示が PBI 前後で差分ゼロであることを E2E で保証。

## BDD受け入れシナリオ

```gherkin
Scenario: DiagnosticsCollector が全診断を収集する
  Given dashboard の diagnostics パネルが開かれる
  When DiagnosticsCollector.collect() が呼び出される
  Then storage / extension info / obsidian settings / AI settings / sqlite / deficiencies / built-in AI / compileOptions の全てを含む DiagnosticsSnapshot が返却される
  And 各フィールドは型安全であり、不足フィールドはコンパイルエラーになる

Scenario: renderer が snapshot から DOM を描画する
  Given DiagnosticsSnapshot が与えられる
  When DiagnosticsRenderer.render(snapshot) が呼び出される
  Then 各診断セクションの DOM（stat rows, badges, warnings）が正しく描画される
  And chrome.* API へのアクセスは発生しない（純粋な DOM 描画のみ）

Scenario: テストで fake snapshot が使える
  Given テスト環境で fake DiagnosticsSnapshot が与えられる
  When renderer.render(fakeSnapshot) が呼び出される
  Then offscreen や chrome.storage をモックせず、DOM の描画結果を検証できる

Scenario: 収集失敗が適切にハンドリングされる
  Given SQLite の取得が失敗する環境で collect() が呼び出される
  When DiagnosticsCollector.collect() が実行される
  Then sqlite フィールドは { error: "..." } を含み、他のフィールド（storage, ai 等）は正常に収集される
  And パネル全体がクラッシュせず、失敗したセクションのみエラー表示になる

Scenario: 新しい診断項目の追加が容易になる
  Given 開発者が新しい診断項目（例: lastSyncTime）を追加する
  When DiagnosticsSnapshot 型に lastSyncTime フィールドを追加し、collector に収集ロジックを追加する
  Then renderer は snapshot.lastSyncTime を参照するだけで表示でき、既存の11セクションに影響しない
```

## 受け入れ基準
- [ ] `DiagnosticsCollector` モジュールが `src/dashboard/panels/diagnostic/DiagnosticsCollector.ts`（または `src/dashboard/diagnostics/DiagnosticsCollector.ts`）に作成される。公開 interface は `collect() => Promise<DiagnosticsSnapshot>` のみ。
- [ ] `DiagnosticsSnapshot` 型が定義される。全ての診断フィールド（storage, extInfo, obsidianSettings, aiSettings, sqlite, deficiencies, builtInAi, compileOptions, divergenceWarning 等）を含む。フィールドの追加・削除が型レベルで検出される。
- [ ] `DiagnosticsRenderer`（または `renderDiagnostics(snapshot, container)` 関数）が作成される。snapshot を受け取り DOM を描画する純粋なレンダラ。`chrome.*` へのアクセスを含まない。
- [ ] `src/dashboard/panels/diagnostic/diagnosticsPanel.ts`（681行）が `DiagnosticsCollector` + `DiagnosticsRenderer` への薄い委譲に縮小される（~80行以内）。`loadAndPopulate()` 内の11セクションの imperative な `querySelector → innerHTML → appendChild` が全て削除される。
- [ ] `chrome.storage.local`, `getSqliteStatus`, `getLogCount`, `checkBuiltInAiAvailability`, `diagnoseDeficiencies` 等の依存が `DiagnosticsCollector` に注入可能な adapter として抽象化される。テストでは InMemory fake を注入。
- [ ] 既存の `makeStatRow` / `getSeverityLabel` / `formatProviderHeadline` 等のレンダリング helper は `DiagnosticsRenderer` 内部で再利用される（削除しない）。
- [ ] 既存の diagnostics 関連テスト（`diagnosticsPanel` を直接テストするものがあれば）が `DiagnosticsCollector` の interface テストと `DiagnosticsRenderer` の snapshot テストに移行する。

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- dashboard の diagnostics パネルを開き、全11セクションが正しく表示されることを検証（既存の手動テストを自動化）。

### 統合テスト
- `DiagnosticsCollector` × fake `chrome.storage` × fake `SqliteClient` で、全フィールドが正しく収集されることを検証。
- `DiagnosticsCollector` × 失敗する `getSqliteStatus` で、部分失敗が適切にハンドリングされることを検証。
- `DiagnosticsRenderer` × fake `DiagnosticsSnapshot` で、DOM 描画が正しく行われることを検証（jsdom 環境）。

### 単体テスト
- 本PBIでは collector/renderer 個別の単体テストを追加しない — 深いモジュールのテストは interface（`collect() → snapshot`）と renderer（`render(snapshot) → DOM`）の2つの seam でカバーする。境界値（空 snapshot / 部分失敗 snapshot）は interface テストで検証。

## 実装アプローチ
- **Outside-In**: まず `DiagnosticsCollector` の E2E テスト（全11セクションの収集）を RED にし、既存の `diagnosticsPanel.ts` ロジックを collector 内部に移動して GREEN にする。
- **Red-Green-Refactor**: セクションを3つずつ移行（storage+extInfo+obsidian → ai+sqlite+deficiencies → builtInAi+compileOptions+actions の順）し、都度 GREEN を確認。
- **リファクタリング**: GREEN になるたびに `querySelector` の文字列定数を snapshot フィールド名に置換し、typo 耐性を向上。

## 見積もり
3人日

## 技術的考慮事項
- 依存関係: `chrome.storage.local`（local-substitutable — InMemory fake で代替可能）、`getSqliteStatus` / `getLogCount`（03の BrowsingLogRepository 経由で取得。03が未完了の場合は一時的に直接呼び出し）、`checkBuiltInAiAvailability`（in-process）。
- テスタビリティ: `DiagnosticsCollector` は依存を注入可能にする（`{ storage, sqlite, ai }` adapters）。テストでは fake adapters を注入し、chrome.* をモックしない。`DiagnosticsRenderer` は純粋な DOM 描画なので jsdom でテスト可能。
- 非機能要件: パネル表示のパフォーマンス — `collect()` は並列に全診断を収集する（`Promise.all`）。現行の逐次 `await` より高速になる。
- ADR整合性: なし（diagnostics パネルに関する ADR は存在しない）。

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "diagnosticsPanel\|DiagnosticsPanel\|diag.*Stats" src/dashboard/ --include="*.ts" | head -30
grep -rn "makeStatRow\|diagnoseDeficiencies\|checkBuiltInAi" src/ --include="*.ts" | head -20
wc -l src/dashboard/panels/diagnostic/diagnosticsPanel.ts
```
- 既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。`diagnosticsPanel.ts` は 2026-08-20 時点で 681行の god module として存在する。

### 実装手順
1. `src/dashboard/panels/diagnostic/DiagnosticsSnapshot.ts` を新規作成し、`DiagnosticsSnapshot` 型を定義（全11フィールド）。
2. `src/dashboard/panels/diagnostic/DiagnosticsCollector.ts` を新規作成。`collect()` が `Promise.all` で全診断を並列収集し、失敗したフィールドは `{ error }` で包む。
3. `src/dashboard/panels/diagnostic/DiagnosticsRenderer.ts` を新規作成。`render(snapshot, container)` が snapshot から DOM を描画。既存の `makeStatRow` 等を再利用。
4. `src/dashboard/panels/diagnostic/diagnosticsPanel.ts` を collector + renderer への委譲に書き換え（~80行）。`createDiagnosticsPanel()` は `collect() → render()` の2行になる。
5. テストを `DiagnosticsCollector.test.ts` と `DiagnosticsRenderer.test.ts` の interface テストに移行。旧テストは削除。

### 落とし穴
- `diagnosticsPanel.ts` 内の `debugMode` による `compileOptionsSection` の表示切り替え（`chrome.storage.local.get('debugMode')`）は、collector が `debugMode` を snapshot に含めることで renderer が判定するように移行すること。collector が `debugMode` を知らないと renderer が chrome.* に依存してしまう。
- `renderBuiltInAiStatus()` は `downloadBtn` の表示切り替えを伴う — renderer が snapshot から `builtInAi.status === 'downloadable'` を判定して btn の hidden を切り替えるようにすること。現行の `classList.toggle('hidden', ...)` をそのまま移植。
- `diagDivergenceWarning` の表示は `diagnoseDeficiencies` の結果に依存する — collector が両方を収集し、renderer が `snapshot.divergenceWarning` の有無で表示を切り替える。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする（全11セクション + 部分失敗 + fake snapshot）
- [ ] テストカバレッジが基準を満たす（既存11セクションのカバレッジが維持される）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（681行 → ~120行（collector）+ ~80行（renderer）+ ~60行（panel 委譲））
- [ ] ドキュメント更新済み
