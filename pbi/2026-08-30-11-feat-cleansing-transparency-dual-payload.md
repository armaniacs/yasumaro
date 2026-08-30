# PBI: クレンジングの透明性を高める二重ペイロード方式を導入する

## ユーザーストーリー

閲覧者として、クレンジングで何が除去されたかを知りたい。なぜなら現行は `cleansedBytes` と `aiSummaryCleansedElements` の数値のみで、「除去された中に価格情報や重要な補足が含まれていたか」を判断できないから。

## 優先度

- 順位: 11 / 15
- RICE: Reach 6 / Impact 2 / Confidence 0.5 / Effort 3日 = 2.0
- 根拠: 上級者向けの透明性向上。AI要約の信頼性に直結するが、全ユーザーが求める機能ではない。実装は `ExtractResult` の拡張とUI表示で局所的。

## 背景

- 現行: `ExtractResult` は `content` (クレンジング後のテキスト) のみを保持。`aiSummaryOriginalBytes` / `aiSummaryCleansedBytes` / `aiSummaryCleansedElements` / `aiSummaryCleansedReason` で「どれだけ除去されたか」は分かるが、「何が除去されたか」は分からない。
- 課題: 除去された中に価格・日付・出典等の重要情報が含まれていた場合、AI要約が不正確になる。ユーザーは除去の副作用を検証できない。
- 機会: クレンジング前後のテキスト差分を保持し、AI要約プロンプトに「除去された内容の要約」を付記するか、ダッシュボードで差分を可視化する。LLMに両方を渡し「除去内容に重要な情報が含まれていたか」を自己評価させることも可能。

## BDD 受け入れシナリオ

```gherkin
Scenario: クレンジング前後の差分が保存される
  Given ページでクレンジングが実行された
  When ExtractResult を確認する
  Then cleansedContent と originalContent の両方が保持されている
  And 差分(除去されたテキスト)が取得できる

Scenario: ダッシュボードで差分を確認できる
  Given クレンジングで10要素が除去された
  When ダッシュボードの履歴詳細を開く
  Then 除去された要素の概要(ルール別件数と代表テキスト)が表示される

Scenario: AI要約に除去内容の注記が付く(将来拡張)
  Given クレンジングで価格情報が除去された可能性がある
  When AI要約を生成する
  Then プロンプトに「除去された内容: 価格情報3件」と注記が付く
  And AIは注記を考慮して要約を生成する

Scenario: 差分が大きい場合は警告が表示される
  Given クレンジングで80%以上のテキストが除去された
  When 履歴詳細を確認する
  Then 「多くの内容が除去されました。原文を確認してください」と警告が表示される
```

## 受け入れ基準

- [ ] `ExtractResult` に `originalContent` または `removedContent` (除去されたテキスト)が追加される(または `aiSummaryCleansedReasons` の詳細化)
- [ ] `contentExtractor/index.ts` の `runAiSummaryCleanse` でクレンジング前後のテキスト差分を計算し保存する
- [ ] ダッシュボードの履歴詳細または `cleansingStatsView` で除去内容の概要が確認できる
- [ ] 差分が大きい場合(例: 80%以上除去)の警告表示がある(任意)
- [ ] AI要約プロンプトへの注記付与は本PBIではスコープ外とし、将来PBIとして分離することを明記
- [ ] `npm run validate` が通る

## テスト戦略

### E2E
- 手動: ダッシュボードでクレンジング実行後の差分表示を目視確認

### 統合
- `contentExtractor/index.test.ts` に差分計算の統合テスト。クレンジング前後のテキストから差分が正しく計算される

### 単体
- 差分計算関数の単体テスト: 完全一致 / 部分除去 / 全除去 / 空差分
- `ExtractResult` の新フィールドの型テスト
- 警告閾値の境界テスト: 79% / 80% / 81%

## 実装アプローチ

- **Outside-In**: `ExtractResult` の型拡張テストを先に書く → `contentExtractor/index.ts` で差分計算を実装 → ダッシュボードUI → グリーン
- **段階移行**: Phase 1は `ExtractResult` に `removedContent` を追加し、ダッシュボードで表示するのみ。Phase 2でAIプロンプトへの注記付与。Phase 1の成功をPhase 2の前提とする

## 見積もり

3pt (差分計算1 + 型拡張1 + UI1)

## 技術的考慮事項

- 依存: `ExtractResult` 型 / `contentExtractor/index.ts` / `dashboard` パネル
- テスタビリティ: 差分計算は純粋関数。jsdomで検証可能
- 非機能: `removedContent` の保存による `chrome.storage.local` / SQLite の容量増。長文ページで差分が数KBになる。保存期間は `CONTENT_RETENTION_DAYS` と同様にパージ対象に
- プライバシー: 差分には除去された広告テキストが含まれる。個人情報は含まれないが、保存時のサニタイズは不要

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "ExtractResult\|aiSummaryCleansed" src/utils/contentExtractor/types.ts
cat src/utils/contentExtractor/index.ts | grep -n "preCleanseText\|aiSummaryCleanse"
cat src/dashboard/cleansingStatsView.ts | head -n 50
```

### 実装手順
1. `src/utils/contentExtractor/types.ts` の `ExtractResult` に `removedContent?: string` または `removedByRule: Record<RuleKey, string[]>` を追加
2. `src/utils/contentExtractor/index.ts` の `runAiSummaryCleanse` で `preCleanseText` とクレンジング後テキストの差分を計算。簡易的には `preCleanseText` から `clone.textContent` を除いた部分
3. `src/dashboard/cleansingStatsView.ts` または履歴詳細パネルで差分を表示。ルール別件数 + 代表テキスト(先頭100字)
4. テスト: `contentExtractor/index.test.ts` に差分計算のテストを追加

### 落とし穴
- `preCleanseText` は `clone.textContent` で取得されるが、クレンジング後のテキストは `extractTextFromElement` で正規化されるため、単純な文字列差分では正確な除去内容が得られない。`clone` の `outerHTML` 差分を取るか、削除要素の `textContent` を記録する方が正確
- `removedContent` を毎回保存するとストレージを圧迫する。差分が大きい場合のみ保存するか、要約(先頭500字)に留める
- `fallbackTriggered` 時は `preCleanseText` にフォールバックするため、差分の意味が変わる。フォールバック時は差分を `undefined` にすること

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
