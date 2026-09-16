# PBI: OpenAI 互換系プロバイダーの接続テストで誤った表示ラベルが出る問題の修正

優先度: 順位 1 / 10（RICE: 20.0 = Reach 5 / Impact 2 / Confidence 1.0 / Effort 0.5 pt）
backlog: [2026-09-17-00-backlog-arch-review-0917.md](2026-09-17-00-backlog-arch-review-0917.md)（台帳）
依存: なし（本 PBI は testConnection テンプレ化 PBI の前提条件として先に着手する）

## ユーザーストーリー
ローカル AI（LM Studio / Ollama など）を優先スロットに設定したユーザーとして、接続テスト失敗時は設定中のプロバイダー名で案内してほしい、なぜなら「OpenAI の API キーを確認してください」と表示されると原因の切り分け先を誤るから。

## 背景（現状と課題）
- `GenericOpenAICompatibleProvider` は providerCatalog 上の openai / openai2 / lm-studio / ollama / openai-compatible を1クラスで担う（`createProviderStrategy` が gemini と built-in-ai 以外をこのクラスに振り分ける構成を読み取りで確認）。
- 一方 `testConnection()` 内の HTTP エラー時の呼び出しは第2引数を `'OpenAI'` でハードコードしている（`testConnection()` 内の `mapConnectionError` 呼び出しを読み取りで確認）。
- `mapConnectionError` の文言テーブルはプロバイダーラベルを埋め込む形式（`Check your ${providerLabel} API key` 形式を `ProviderStrategy.ts` の `mapConnectionError` 定義で確認）のため、LM Studio や Ollama での 401 失敗時に OpenAI が原因であるかのような誤った案内が出る。
- 正しくは `this.providerName`（呼び出し元から渡されたプロバイダー名）を渡すこと。文言テーブル自体は変更しない。
- 将来計画として別 PBI（pbi/2026-09-17-10-refactor-ai-test-connection-template.md）がこの `testConnection` を `executeHttpTestFlow` テンプレに統合する予定であり、本 PBI はその前提条件として最小差分（1行＋テスト）に留める。

## BDD受け入れシナリオ
```gherkin
Scenario: lm-studio の接続テストが 401 で失敗したら lm-studio 名で案内される
  Given プロバイダーに lm-studio を設定している
  When 接続テストの HTTP 応答が 401 で失敗する
  Then 失敗メッセージに lm-studio（プロバイダー名）が含まれ、OpenAI という語を含まない

Scenario: openai の接続テストが 401 で失敗したら従来どおり OpenAI と案内される
  Given プロバイダーに openai を設定している
  When 接続テストの HTTP 応答が 401 で失敗する
  Then 失敗メッセージに従来どおり OpenAI の文言が表示される（既存挙動の pin）
```

## 受け入れ基準
- [ ] lm-studio 設定で接続テストが HTTP 401 失敗時、メッセージに lm-studio が含まれ OpenAI を含まない
- [ ] openai 設定で接続テストが HTTP 401 失敗時、従来どおり OpenAI の文言が表示される
- [ ] `mapConnectionError` の文言テーブル自体に変更がない
- [ ] 変更差分が `testConnection()` 内の該当1行とテスト追加に留まる（テンプレ化には踏み込まない）
- [ ] OpenAIProvider 系の既存テストが green のままである
- [ ] `npm run type-check` が green である

## テスト戦略
- `src/background/ai/providers/__tests__/` 配下の既存スタイル（`fetchWithRetry` をモックし `testConnection` の 401 / 404 / 成功を検証する形式）に倣い、lm-studio 名での 401 テストと openai 名での既存挙動 pin テストを追加する
- 既存スイート全体の回帰確認（OpenAIProvider 系テストを含む）
- type-check による型検証

## 見積もり
0.5 pt（1行修正＋テスト追加の小規模変更。テンプレ化は別 PBI の範囲）

## 実装ガイド

### 作業順序（推奨）
1. `OpenAIProvider.ts` の `testConnection()` 内の `mapConnectionError` 呼び出しを読み、ハードコード箇所を確認する
2. 第2引数の `'OpenAI'` を `this.providerName` に差し替える（1行のみ）
3. lm-studio の 401 ケースと openai の既存挙動 pin ケースのテストを追加する
4. `npm run type-check` と関連テストを実行して green を確認する

### スコープ注意
- `mapConnectionError` の文言テーブルは変更しない
- `testConnection` の `executeHttpTestFlow` テンプレへの統合は別 PBI の範囲であり、本 PBI では行わない
- `testConnection()` 内の catch 経路にも同様の `'OpenAI'` 渡しが存在することは読み取りで確認したが、本 PBI の変更対象外とする（テンプレ化 PBI 側の判断に委ねる）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
- [ ] 既存の OpenAIProvider 系テストと type-check が green である
