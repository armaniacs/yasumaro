# PBI: 診断パネルの二重実装解消と表示ロジックの共通化

## ユーザーストーリー
開発者として、診断パネルの修正が1ファイルの変更だけで済むことを望む。なぜなら、現在 `src/dashboard/diagnosticsPanel.ts` と `src/dashboard/panels/diagnostic/diagnosticsPanel.ts` にほぼ同一の実装が存在し、毎回両方を修正する手間と、更新漏れによる不整合のリスクがあるためである。

## ビジネス価値
- **保守性向上**: 修正・機能追加の工数を約50%削減。
- **品質向上**: 二重実装の乖離によるバグを防止。
- **技術的負債削減**: 710行 + 610行 ≈ 1300行の重複コードを整理。

## BDD受け入れシナリオ

```gherkin
Scenario: 診断パネルの修正が1箇所だけで済む
  Given 開発者が新しい診断項目を1つのファイルに追加した
  When 診断パネルを開いた
  Then 新旧どちらの参照経路でも同じ情報が表示され、片方だけ更新し忘れることがなくなる

Scenario: プロバイダ設定表示がデータ駆動で描画される
  Given 新しいプロバイダ "new-provider" の設定（Base URL, Model, API Key）を追加した
  When 診断パネルの「AI 設定」セクションを表示した
  Then コード上の if-else 分岐を追加しなくても、新しいプロバイダの設定が適切なラベル付きで表示される
```

## 受け入れ基準
- [ ] `src/dashboard/diagnosticsPanel.ts` と `src/dashboard/panels/diagnostic/diagnosticsPanel.ts` の重複ロジックが解消され、一方が他方を参照するか、共通コンポーネントに抽出されている
- [ ] AIプロバイダー設定表示の if-else 連鎖が、プロバイダ→StorageKeysのマップを用いたデータ駆動型の表示に置き換えられている
- [ ] `makeStatRow` が共通ユーティリティとして抽出され、1箇所の定義で全パネルが利用している
- [ ] 診断パネルの全テスト操作（Obsidianテスト、AIテスト、SQLiteテスト、OPFS Spike、Migration、Backfill、Cleanup）が引き続き正常に動作する
- [ ] 既存の全テストがパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- [ ] 診断パネルの各種テストボタン（Obsidian、AI、SQLite等）が統合後も正常に動作すること

### 統合テスト
- [ ] 統合後のパネルが `createDiagnosticsPanel()` または `initDiagnosticsPanel()` で正しく初期化されること
- [ ] 統合後のパネルが `DiagnosticPanel` インターフェースを満たしていること

### 単体テスト
- [ ] 共通化したユーティリティ関数（`makeStatRow`、`getSeverityLabel`等）のテスト
- [ ] データ駆動型プロバイダ設定表示のユニットテスト

## 実装アプローチ
- **Outside-In**: まず現在の両方のパネルに対するテストが通ることを確認し、統合後も同じテストがパスすることを確認する
- **Red-Green-Refactor**: 統合を段階的に行い、各ステップでテストを実行する
- **漸進的移行**: 先に共通ユーティリティを抽出し、その後にパネルロジックを片方に集約する

## 見積もり
8pt（影響範囲が広く、慎重なテスト確認が必要）

## 技術的考慮事項
- 現状の2ファイルの差分を事前に精査し、意図的な差分（片方だけにある機能）と単なる重複を区別する必要がある
- `createDiagnosticsPanel()` は `DiagnosticPanel` インターフェースを返すが、`initDiagnosticsPanel()` は DOM に直接操作する。統合時に関数シグネチャを統一する必要がある

## 実装者向け注記

### 現状コードの確認
```bash
# 2つのファイルの差分を確認
diff src/dashboard/diagnosticsPanel.ts src/dashboard/panels/diagnostic/diagnosticsPanel.ts

# makeStatRow の定義箇所
grep -rn "function makeStatRow" src/dashboard/
```

### 実装手順
1. 2ファイルの差分を精査し、意図的な差異を特定する
2. `makeStatRow`、`getSeverityLabel` を共通ユーティリティファイルに抽出する
3. プロバイダ設定の if-else 連鎖をデータ駆動型マップに置き換える
4. `src/dashboard/diagnosticsPanel.ts` を削除し、`panels/diagnostic/diagnosticsPanel.ts` に一本化する
5. 削除ファイルを import しているテスト・呼び出し元を修正する

### 落とし穴
- 意図的な差分（例: レガシー版にあるが新パネルにはない機能）を見逃して削除しないこと
- `createDiagnosticsPanel()` と `initDiagnosticsPanel()` の呼び出し元が異なるAPIを使っている可能性がある

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 診断パネルの実装が1つに統一され、重複コードが解消されている
- [ ] AIプロバイダ設定表示がデータ駆動型に変更されている
- [ ] 既存の全テストがパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
