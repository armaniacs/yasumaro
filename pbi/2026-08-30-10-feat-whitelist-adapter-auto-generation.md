# PBI: ホワイトリストアダプターをLLMで自動生成する

## ユーザーストーリー

開発者として、新しいドメインのホワイトリストアダプターを手書きせずに生成したい。なぜなら現行 `whitelistAdapters.ts` は各ドメインの `article` / `main` セレクタを手動で調査・記述しており、新ドメイン対応のたびに数時間の調査が必要だから。

## 優先度

- 順位: 10 / 15
- RICE: Reach 3 / Impact 2 / Confidence 0.4 / Effort 5日 = 0.48
- 根拠: 新ドメイン対応の頻度は低く、Reachは小さい。LLMの推論精度も不確実。だが成功すればブラックリストの出番自体が減り、クレンジング全体の精度が上がるEnabler。

## 背景

- 現行: `src/utils/contentExtractor/whitelistAdapters.ts` にドメイン別の `Adapter` 定義。各アダプタは `hostname` と `selectors` (例: `article`, `.post-content`) を持つ。`matchWhitelistAdapter` でホスト名マッチ→ `extractWhitelistedContent` で抽出。
- 課題: 新ドメイン(例: 新興メディア)の本文セレクタを手動で特定するのは時間がかかる。ブラックリスト方式では広告除去が不完全。
- 機会: 対象ドメインのHTMLを `fetch` で取得し、LLMに「本文セレクタを推論せよ」と問い合わせる。LLMが `article` / `main` / `.entry-content` 等を提案し、PRとして自動生成するバッチを構築。

## BDD 受け入れシナリオ

```gherkin
Scenario: LLMがホワイトリストアダプターを提案する
  Given example.com のHTMLがある
  And LLMプロバイダが設定されている
  When 「example.com の本文セレクタを推論せよ」とLLMに問い合わせる
  Then article または main または .post-content 等のセレクタ候補が返る
  And 該当セレクタで本文が抽出できることを検証する

Scenario: 生成されたアダプターがPRとして作成される
  Given LLMがセレクタ候補を提案した
  And 該当セレクタで本文抽出が成功した
  When バッチが whitelistAdapters.ts に新アダプターを追加するPRを作成する
  Then PRにはセレクタと検証結果(抽出文字数)が含まれる

Scenario: 誤ったセレクタは棄却される
  Given LLMが誤ったセレクタ「.sidebar」を提案した
  When 該当セレクタで本文抽出を試みる
  Then 抽出文字数が閾値未満のため棄却され、PRは作成されない

Scenario: LLMが利用不可ならスキップする
  Given LLMプロバイダが未設定である
  When バッチを実行する
  Then LLM推論はスキップされ、既存アダプターのみで動作する
```

## 受け入れ基準

- [ ] `scripts/generate-whitelist-adapter.mjs` または `src/utils/whitelistGenerator.ts` がLLM経由でセレクタ候補を生成できる
- [ ] 生成されたセレクタで `extractWhitelistedContent` が閾値(例: 500字)以上の本文を抽出できることを検証する
- [ ] 検証成功時に `whitelistAdapters.ts` への追加差分を含むレポート/PRが出力される
- [ ] LLM未設定時はスキップし、既存機能に影響しない
- [ ] `npm run validate` が通る

## テスト戦略

### E2E
- 手動: 実ドメイン(例: zenn.dev)でバッチを実行し、生成されたアダプターで本文が正しく抽出されることを目視確認

### 統合
- `whitelistAdapters.test.ts` に生成されたアダプターの統合テスト。生成→検証のパイプラインをモックLLMでテスト

### 単体
- セレクタ検証ロジックの単体テスト: 閾値判定 / 空抽出 / 複数候補の優先度
- LLMプロンプト生成の単体テスト: HTMLから本文セレクタ推論プロンプトが正しく生成される
- バッチのエラーハンドリングテスト: LLM失敗 / HTML取得失敗 / 検証失敗

## 実装アプローチ

- **Spike分離**: LLMの推論精度が不確実なため、まず手動で3ドメインに対してLLM推論を試し、精度を測定するスパイクから始める
- **Outside-In**: スパイクで精度確認 → セレクタ検証ロジックのテストを先に書く → LLM連携実装 → バッチ化
- **段階移行**: Phase 1は手動トリガーの `scripts/` バッチ。Phase 2で定期実行の自動PR生成。Phase 1の成功をPhase 2の前提とする

## 見積もり

5pt (スパイク1 + LLM連携2 + バッチ1 + テスト1)

## 技術的考慮事項

- 依存: `src/background/ai/` の既存AIプロバイダ( `AIService` )を流用可能。プロンプトは `src/utils/contentExtractor/whitelistAdapters.ts` の既存アダプタを few-shot 例として含める
- テスタビリティ: LLM呼び出しは `AIService` のモックでテスト。セレクタ検証は純粋関数
- 非機能: LLM呼び出しのコスト。1ドメインあたり数百トークン。100ドメインで数万トークン
- セキュリティ: `fetch` で取得したHTMLをLLMに渡す際のプライバシー。外部送信前にPIIサニタイズを検討

## 実装者向け注記

### 現状コードの確認
```bash
cat src/utils/contentExtractor/whitelistAdapters.ts | head -n 100
grep -rn "whitelistAdapter\|WHITELIST_EXTRACTION" src/ --include="*.ts" | head -n 20
cat src/background/ai/providers/*.ts | head -n 30
```

### 実装手順
1. スパイク: 3ドメイン(例: zenn.dev, qiita.com, note.com)のHTMLを取得し、LLMに手動で問い合わせて精度を測定
2. `scripts/generate-whitelist-adapter.mjs` を作成。引数でドメインを受け取り、HTML取得→LLM推論→セレクタ検証→レポート出力
3. `src/utils/whitelistGenerator.ts` にセレクタ検証ロジック( `extractWhitelistedContent` で閾値チェック )を実装
4. 統合テストでモックLLMを使いパイプラインを検証

### 落とし穴
- LLMは `div` や `body` などの広すぎるセレクタを提案する場合がある。検証時の閾値(文字数)だけでなく、抽出テキストの品質(広告含有率)もチェックすべき
- `fetch` で取得したHTMLはログイン後のコンテンツを含まない。認証が必要なサイトは対象外
- `whitelistAdapters.ts` の `hostname` は完全一致。サブドメイン対応が必要な場合は `endsWith` 判定に変更する必要がある

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
