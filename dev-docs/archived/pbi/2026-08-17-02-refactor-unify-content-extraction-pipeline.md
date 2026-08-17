# PBI: コンテンツ抽出パイプラインの重複を統一する

## ユーザーストーリー
開発者として、`src/content/extractor.ts` の `extractPageContent` と `src/utils/contentExtractor/index.ts` の `extractMainContent` の間で重複しているオプション構築とクレンジングパスを統一したい。なぜなら、AI要約クレンジングのルールを追加するたびに2箇所を修正する必要があり、重複がバグの温床になっているから。

## ビジネス価値
- ルール追加や設定変更時の修正箇所を半減させる
- Content Script とユーティリティの出力が常に一致する信頼性を高める
- 新しいクレンジングオプションの追加コストを下げる

## BDD受け入れシナリオ

```gherkin
Scenario: ページ訪問時の自動記録
  Given ユーザーが有効なページを訪問している
  When Content Script が `extractPageContent` を呼び出す
  Then 統一されたパイプラインが実行される
  And 従来と同じ content / cleanse stats / byte stats が返る

Scenario: Dashboard からの手動抽出
  Given ユーザーが Dashboard で手動記録を実行する
  When バックグラウンドがコンテンツ抽出を要求する
  Then `extractMainContent` も統一されたオプション構築を経由する
  And Content Script 経由の結果と整合性が保たれる

Scenario: 新しいクレンジングルールの有効化
  Given 新しい AI要約クレンジングルールが追加された
  When 設定を有効にする
  Then オプション変換は1箇所のみの変更で反映される
  And Content Script とユーティリティの両方でルールが有効になる
```

## 受け入れ基準
- [ ] `extractPageContent` と `extractMainContent` の間で重複したオプションオブジェクト構築が除去されている
- [ ] 1箇所の shared option builder または intermediate API が存在する
- [ ] Content Script とユーティリティの出力が同一 HTML に対して一致する
- [ ] 既存の content extractor テストと extractor テストがすべてパスする
- [ ] 新しいルール追加時に2箇所以上の修正が発生しない構造になっている

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 実際のウェブページに対する自動記録シナリオが従来通り動作する

### 統合テスト
- `extractPageContent` → `extractMainContent` の呼び出し経路が統一 builder を介すること
- Dashboard 手動記録経路でも同じ builder を介すること

### 単体テスト
- option builder: すべての設定キーが正しく変換される
- 各クレンジングルール有効/無効時の出力差分
- 境界値: 空の設定、最大文字数、フォールバック閾値
- 例外ハンドリング: `document.body` 不在、無効な `maxChars`

## 実装アプローチ
- **Outside-In**: `extractPageContent` のテストを先に書き、内部を統一 builder に置き換える
- **Red-Green-Refactor**: builder の抽出 → 両経路から利用 → 重複削除

## 見積もり
3ポイント

## 技術的考慮事項
- 依存関係: `src/content/pageState.ts`、`src/utils/contentCleaner.ts`、`src/utils/aiSummaryCleaner/index.ts`、`src/utils/contentDeduplicator.js`
- テスタビリティ: builder は pure function として DOM に依存しないようにし、jsdom でもテスト可能にする
- 副作用: Content Script の実行結果が変わると AI要約品質に影響するため、入出力は完全一致させる

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "extractMainContent" src/
grep -rn "extractPageContent" src/
```

### 推奨構成
```
src/content/
  extractor.ts                         # Content Script エントリ。DOM/設定依存処理のみ残す
  extractPageContent.ts                # extractPageContent を shared pipeline 経由にリダイレクト
src/utils/contentExtractor/
  optionBuilder.ts                     # CleansingConfig -> CleanseOptions / AiSummaryCleanseOptions
  pipeline.ts                          # findCandidates -> cleanse -> dedup -> truncate
  index.ts                             # extractMainContent を pipeline 経由に実装
```

### 落とし穴
- `pageState` への side effect（`lastCleansedReason`、`lastByteStats` など）は Content Script 側で保持する必要がある
- `returnInfo` フラグの有無で戻り型が変わるため、shared pipeline は両方の戻り型を維持する
- `whitelistExtractionEnabled` の判定は DOM/URL に依存するため、builder ではなく pipeline 側で処理する

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テストがすべてパスする
- [ ] Content Script とユーティリティの出力一致を検証するテストが追加されている
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（必要に応じて）
