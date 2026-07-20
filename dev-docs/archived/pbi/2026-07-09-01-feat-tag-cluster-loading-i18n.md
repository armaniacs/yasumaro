# PBI: Tag Cluster ローディングラベルの i18n 化

## ユーザーストーリー
Yasumaro ダッシュボードを日本語以外の言語で使うユーザーとして、Tag Cluster の 4 段階ローディング進捗ラベルが自分の言語で表示されることを望む。なぜなら現状は `tagClusterLoading.ts` に日本語が直接ハードコードされており、i18n 機構を完全にバイパスしているから。

## ビジネス価値
- 既存の約 90 件のメッセージキーが日英両方に正しく追加されている状態に対し、この 4 ラベルだけが i18n 未対応という不整合を解消し、多言語一貫性を保つ
- 非日本語ユーザーがローディング進捗を理解できるようになる

## 既実装確認（Phase 0）
- `grep -rn "データ読み込み\|ノード分析\|レイアウト計算\|グラフ描画" src/` → `src/dashboard/tagClusterLoading.ts:20-24` のみヒット（ハードコード）。未実装と判断
- `src/popup/i18n.ts` に `getMessage(key)` が存在し、`src/dashboard/exportImport.ts` 等でダッシュボード内から呼ばれていることを確認（再利用可能）
- `public/_locales/{en,ja}/messages.json` が存在（各 2070 キー）。新規キー追加の受け入れ口は確保済み

## BDD受け入れシナリオ

```gherkin
Scenario: ローディングラベルがユーザーの言語で表示される
  Given ユーザーのブラウザ言語が英語に設定されている
  And Tag Cluster パネルがデータ読み込み中である
  When ローディングオーバーレイが描画される
  Then 4 段階のラベルが英語（"Loading data" / "Analyzing nodes" / "Calculating layout" / "Drawing graph"）で表示される
  And ソースコードに日本語のラベル文字列が残っていない

Scenario: メッセージキーが欠落してもクラッシュしない
  Given メッセージキーが messages.json に存在しない異常状態
  When ローディングオーバーレイが描画される
  Then フォールバックとしてキー名または空文字が表示され、拡張機能が例外で停止しない
```

## 受け入れ基準
- [ ] `public/_locales/en/messages.json` と `public/_locales/ja/messages.json` に `tagClusterLoadingStep1`〜`tagClusterLoadingStep4` を追加（日英）
- [ ] `src/dashboard/tagClusterLoading.ts` の `steps` ラベルが `getMessage('tagClusterLoadingStepN')` に置換されている
- [ ] ソースにハードコードされた日本語ラベルが存在しない（`grep` で 0 件）
- [ ] 既存の `tagClusterPanel.test.ts` がパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 見送り（オプションページ向け E2E fixture なし、既存方針に準拠）

### 統合テスト
- `tagClusterLoading.ts` の `show()` 時に `chrome.i18n.getMessage('tagClusterLoadingStep1')` が呼ばれ、渡されたキーがメッセージ定義に存在することを確認

### 単体テスト
- `getMessage` のモックを用い、`steps` が 4 件とも `getMessage` 経由の値を持つこと
- キーが未定義の場合のフォールバック動作

## 実装アプローチ
- **Outside-In**: 統合テスト（getMessage が期待キーで呼ばれる）を先に失敗させ、実装してグリーン
- **Red-Green-Refactor**: 4 ラベルを 1 つずつ置換

## 見積もり
2 pt（既存ヘルパ再利用、キー追加 4 件、テスト 1 ファイル）

## 技術的考慮事項
- 依存関係: なし（既存 PBI `2026-07-08-01-feat-tag-cluster-pan-zoom` の `TagClusterLoadingManager` を拡張する形）
- テスタビリティ: `chrome.i18n.getMessage` を `vi.mock` または `vi.spyOn` でモック
- 非機能要件: なし

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "データ読み込み\|ノード分析\|レイアウト計算\|グラフ描画" src/
# → src/dashboard/tagClusterLoading.ts:20-24
grep -n "getMessage" src/popup/i18n.ts
# → export function getMessage(key, substitutions)
ls public/_locales/en/messages.json public/_locales/ja/messages.json
```

### 実装手順
1. `public/_locales/en/messages.json` に以下を追加:
   ```json
   "tagClusterLoadingStep1": { "message": "Loading data" },
   "tagClusterLoadingStep2": { "message": "Analyzing nodes" },
   "tagClusterLoadingStep3": { "message": "Calculating layout" },
   "tagClusterLoadingStep4": { "message": "Drawing graph" }
   ```
2. `public/_locales/ja/messages.json` に同じキーで日本語を追加（既存ラベルと同一文言）
3. `src/dashboard/tagClusterLoading.ts` 冒頭で `import { getMessage } from '../popup/i18n.js';` し、`steps` の `label` を `getMessage('tagClusterLoadingStep1')` 等に置換
4. 単体テストを追加（getMessage モックでキー呼び出しを検証）

### 落とし穴
- `getMessage` の第 2 引数（substitutions）は今回不要。フォールバックは `getMessage` が未定義時にキー文字列を返す挙動（Chrome 標準）に依存するか、`||` で明示的にフォールバックを用意すること

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] ソースの日本語ハードコードが 0 件
- [ ] コードレビュー完了
- [ ] CHANGELOG.md に記載
