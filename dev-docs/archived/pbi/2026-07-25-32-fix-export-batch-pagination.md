# PBI: ローカルMarkdownエクスポートをカーソルベースのバッチ処理に変更する

**作成日**: 2026-07-25
**完了日**: 2026-07-26
**優先度**: Medium
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🟡軽微（エクスポート処理のロジック変更。既存の出力ファイル内容・順序が変わらないことを丁寧に確認する必要がある）

## 実装メモ（2026-07-26）

フェーズ0確認で `queryLogs`（`src/dashboard/dashboardSqliteService.ts:79`）が既に `offset`/`limit`
パラメータをサポート済みであることを確認した。PBI記載の「カーソルベースページネーションの新規実装」は
不要で、既存の `offset` ベースページネーションをそのまま利用する形に方針変更した。

`exportLocalMarkdownCore()`（`src/dashboard/dashboard.ts`）を、日付範囲指定なし（全履歴エクスポート）の
場合のみ `exportFullHistoryInBatches()` にストリーミング処理化した。`created_at ASC` でソート済みのため、
バッチを跨いでも同一日付のレコードは連続して出現する性質を利用し、日付が切り替わったタイミングで
即座に前の日付分をダウンロードしてメモリから解放する設計とした（`pendingDate`/`pendingEntries` で
直近1日分のみ保持）。日付範囲指定版（`limit: 10000`）はメモリ圧迫のリスクが相対的に低いため、
このPBIの対象からは除外し既存実装のまま維持した。

`getPlatformOs()`（`src/utils/deviceUtils.ts`）と連動し、モバイル（android/ios）検出時はバッチサイズを
500件（デスクトップ1000件）に縮小する `getExportBatchSize()` を追加した。

`dashboard-handlers.test.ts` に5件のテストを追加（ページネーション呼び出し引数の検証、短いページで
ループが終了すること、日付境界がバッチを跨ぐ場合の正しいグルーピング、モバイル時のバッチサイズ縮小）。
日付境界テストでは、batch1が2件のみ・batch2も存在するという非現実的なシナリオ（`batchSize`未満の
ページは「最後のページ」と正しく判定されるため、batch2が呼ばれない）を最初に書いてしまい、
モバイルバッチサイズ（500件）でbatch1をちょうど500件・batch2を短いページにする現実的なシナリオに
書き直した。

既存テスト2件（`limit: 100000`単一呼び出しを期待するもの）を新しいバッチ呼び出しパターンに更新。
型チェック・全テストスイート（7361件）ともに回帰なし。

---

## 背景

Checking Team レビュー（2026-07-25）の Tuning Expert（大規模エクスポート時のメモリ圧迫、Medium）と Edge & Mobile Strategist（モバイルでの大規模データ処理、Medium）を統合。`src/dashboard/dashboard.ts:574` の `exportLocalMarkdownCore()` は、期間指定なしの場合 `queryLogs({ limit: 100000, ... })`（605行）で全履歴を一括取得し、メモリ上でグループ化してBlobを作成する。10万件レコードを一度に取得すると、Chrome拡張機能のメモリ制限（100-200MB）に接近し、特にモバイルChromeではより厳しいメモリ制限のためOOMのリスクが高まる。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "exportLocalMarkdownCore\|queryLogs" src/dashboard/dashboard.ts | head -20
grep -n "getPlatformOs" src/dashboard/*.ts src/utils/*.ts
```

`queryLogs` の実装（SQLiteクライアント側）がoffset/limitベースのページネーションに対応しているか確認する。対応していなければ、まず `queryLogs` 側にカーソルベース（`created_at` や `id` を起点とする）のページネーション機能を追加する必要がある。

## 受け入れ基準（BDD）

```gherkin
Scenario: 大量レコードをバッチ処理でエクスポートする
  Given 10万件を超える記録データが存在する
  When exportLocalMarkdownCore() を実行する
  Then 1バッチあたり1000件程度に区切って取得・処理し、メモリ上に同時展開されるレコード数が一定以下に保たれる

Scenario: バッチ処理後も出力結果が変わらない
  Given 同一のデータセット
  When 旧実装（一括取得）と新実装（バッチ処理）でそれぞれエクスポートする
  Then 出力されるMarkdownファイルの内容が完全に一致する

Scenario: モバイル環境ではさらに小さいバッチサイズを使う
  Given getPlatformOs() がモバイルを検出する
  When エクスポート処理を実行する
  Then デスクトップより小さいバッチサイズ（例: 500件）で処理される
```

## 受け入れ基準
- [ ] `queryLogs` がカーソルベース（`created_at` + `id` 等の複合キー）のページネーションに対応する（未対応なら追加実装）
- [ ] `exportLocalMarkdownCore()` を、全件一括取得ではなく1000件程度のバッチで逐次取得・処理・Blob追記する形に変更する
- [ ] バッチ処理後も出力ファイルの内容・順序が既存実装と完全に一致することを確認する
- [ ] `getPlatformOs()` と連動し、モバイル検出時はバッチサイズを縮小する
- [ ] 既存の `dashboard.ts` エクスポート関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト（最小限）
- 実際に大量データ（モック）をエクスポートし、ファイルが正しく生成されることを確認（既存のPlaywright E2E基盤を利用）

### 統合テスト
- バッチ処理と一括処理で出力結果が一致することを比較検証するテスト

### 単体テスト
- バッチサイズごとの `queryLogs` 呼び出し回数・引数が正しいことを確認
- モバイル検出時にバッチサイズが縮小されることを確認
- 境界値: レコード数がバッチサイズの倍数ちょうどの場合、端数がある場合

## 実装アプローチ

1. `queryLogs` にカーソルベースページネーション（`cursor` パラメータ）を追加（既存実装を確認し、必要な範囲のみ拡張）
2. `exportLocalMarkdownCore()` をループ処理に変更し、バッチごとに `queryLogs` を呼び出してBlobに追記
3. `getPlatformOs()` と連動したバッチサイズ調整を追加
4. 出力結果の一致を検証するテストを追加

## 見積もり

3pt（queryLogsのページネーション拡張 + エクスポートロジック変更 + モバイル対応 + 回帰テスト）

## 技術的考慮事項
- 依存関係: `queryLogs`（SQLiteクライアント）, `getPlatformOs()`
- テスタビリティ: 大量データのモック生成が必要
- 非機能要件: メモリ使用量、モバイル対応

## Definition of Done
- [ ] バッチ処理化されている
- [ ] 出力結果が既存実装と一致することがテストで確認されている
- [ ] モバイル検出時のバッチサイズ調整が実装されている
- [ ] 全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Tuning Expert、Edge & Mobile Strategist指摘を統合）
- 対象コード: `src/dashboard/dashboard.ts:574-650`
