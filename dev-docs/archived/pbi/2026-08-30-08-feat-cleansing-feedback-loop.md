# PBI: クレンジング誤削除のフィードバックループを構築する

## ユーザーストーリー

閲覧者として、クレンジングで本文が誤って削除されたときに「これは本文だ」と報告したい。なぜなら現行は `cleansingStatsView` でバイト削減率を見るだけで、誤削除の修正やパターン改善のフィードバック手段がないから。

## 優先度

- 順位: 08 / 15
- RICE: Reach 6 / Impact 2 / Confidence 0.4 / Effort 5日 = 0.96
- 根拠: 誤削除の報告は改善に直結するが、報告するユーザーは少数。LLMによるパターン自動生成は不確実性が高い。まずは手動報告の収集から始める段階的アプローチ。

## 背景

- 現行: `entrypoints/popup/index.html` の `cleansingInfo` は `cleansingBadge` で削除件数のみ表示。`src/utils/contentExtractor/index.ts` の `deriveCleansedReason` は `removed` map から理由を推定するが、ユーザーは「何が消えたか」を知る手段がない。
- 課題: 誤削除が発生しても開発者に届かない。パターン改善は開発者の手動調査に依存。
- 機会: ポップアップ/ダッシュボードに「誤削除を報告」ボタンを追加。報告されたDOMスニペット(匿名化後)を `patterns.ts` の回帰テストに自動追加するパイプラインを構築。LLMに「この要素は広告か本文か」を判定させ、パターン候補を生成する半自動化も可能。

## BDD 受け入れシナリオ

```gherkin
Scenario: 誤削除を報告できる
  Given ページでクレンジングが実行され、本文の一部が削除された
  When ポップアップの「誤削除を報告」ボタンを押す
  Then 削除された要素の匿名化されたスニペットがローカルに保存される

Scenario: 報告がパターン改善に使われる
  Given 誤削除報告が3件以上集まった
  When 開発者が報告を確認する
  Then 該当パターンの回帰テストが追加され、次回リリースで誤削除が解消される

Scenario: プライバシーが保護される
  Given 誤削除報告に個人情報が含まれる可能性がある
  When 報告が保存される
  Then PIIサニタイズが適用され、個人情報はマスクされる

Scenario: LLMがパターン候補を生成する(将来拡張)
  Given 誤削除報告のスニペットがある
  When LLMに「この要素は広告か本文か」を問い合わせる
  Then 広告/本文の判定と、該当する新規パターン候補が提案される
```

## 受け入れ基準

- [ ] ポップアップまたはダッシュボードに「誤削除を報告」UIが追加される
- [ ] 報告時に削除された要素の `outerHTML` (匿名化後) と `ruleKey` が `chrome.storage.local` に保存される
- [ ] 保存前に `piiSanitizer.ts` によるサニタイズが適用される
- [ ] 報告一覧をダッシュボードで確認できる(開発者向けでも可)
- [ ] 報告から `patterns.test.ts` への回帰テスト追加の手順が `CONTRIBUTING.md` または PBI内に文書化される
- [ ] LLMパターン生成は本PBIではスコープ外とし、将来PBIとして分離することを明記
- [ ] `npm run validate` が通る

## テスト戦略

### E2E
- Playwrightで誤削除報告ボタンを押下し、storageに保存されることを検証

### 統合
- 報告保存の統合テスト: `chrome.storage.local` のモックで保存/読込を検証
- PIIサニタイズ統合テスト: 個人情報を含むスニペットがマスクされることを検証

### 単体
- 報告データ構造の単体テスト: `ruleKey` / `outerHTML` / `timestamp` / `url` のバリデーション
- サニタイズの単体テスト: `piiSanitizer` が報告スニペットに適用される
- 重複報告のテスト: 同一要素の重複報告は1件に集約される

## 実装アプローチ

- **Outside-In**: 報告保存の統合テストを先に書く → `storage/types.ts` に報告用キー追加 → ポップアップUI実装 → ダッシュボード一覧
- **段階移行**: Phase 1は手動報告の収集のみ。Phase 2でLLMパターン生成を追加。Phase 1の成功をPhase 2の前提条件とする

## 見積もり

5pt (報告UI2 + 保存2 + 一覧1)

## 技術的考慮事項

- 依存: `piiSanitizer.ts` / `storage/types.ts` / `chrome.storage.local`
- テスタビリティ: 報告保存は `StoragePort` 経由でテスト可能
- 非機能: 報告データの容量。1報告あたり ~1KB、100件で100KB。定期的なパージが必要
- プライバシー: 報告はローカルのみ保存。外部送信はしない。PIIサニタイズは必須
- 将来: LLMパターン生成は `src/background/ai/` の既存プロバイダ経由で実装可能

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "cleansingBadge\|cleansingInfo" entrypoints/popup/
grep -rn "piiSanitizer\|sanitize" src/utils/
cat src/utils/storage/types.ts | grep -n "CLEANSING"
```

### 実装手順
1. `storage/types.ts` に `CLEANSING_FEEDBACK: 'cleansing_feedback'` を追加。型は `{ ruleKey: RuleKey; outerHTML: string; url: string; timestamp: number }[]`
2. `src/popup/main.ts` または `src/dashboard/cleansingFeedback.ts` に報告ボタンのハンドラを追加。`chrome.tabs.query` で現在のDOM取得は不可のため、Content Script 経由で `outerHTML` を取得
3. 保存前に `piiSanitizer.sanitize` を適用
4. ダッシュボードに報告一覧パネルを追加(簡易なテーブルで可)
5. `CONTRIBUTING.md` に報告から回帰テスト追加の手順を追記

### 落とし穴
- Content Script から `outerHTML` を取得するには `chrome.runtime.sendMessage` 経由が必要。`GET_CONTENT` ハンドラと同様のパターン
- `outerHTML` には `script` タグや `style` が含まれる可能性。保存前に `script` / `style` は除去すること
- 報告の `url` はプライバシー上保存しない方がよい場合もある。保存するなら `hostname` のみに正規化

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
