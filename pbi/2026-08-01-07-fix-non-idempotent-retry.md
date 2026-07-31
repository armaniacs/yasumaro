# PBI: 非冪等な POST リクエストの 5xx 再送を防止する

## ユーザーストーリー
ユーザーとして、AI 要約リクエストがサーバ側で処理された後に 5xx が返ってきた場合、二重に生成・課金されないようにしたい。

## ビジネス価値
- 二重課金を防ぐ
- 重複サマリの生成を防ぐ
- API プロバイダーとの信頼性向上

## BDD受け入れシナリオ

```gherkin
Scenario: POST 生成リクエストの 5xx は再送しない
  Given OpenAI プロバイダーで要約リクエストを送信する
  When サーバが 500 を返す
  Then リトライは行われない

Scenario: GET 確認リクエストの 5xx は再送する
  Given testConnection が GET /models を送信する
  When サーバが 503 を返す
  Then 安全な範囲で再送される
```

## 受け入れ基準
- [ ] `fetchWithRetry` / `defaultShouldRetry` が HTTP メソッドを考慮する
- [ ] POST/PUT/PATCH の 5xx は再送しない（または冪等性トークンありの場合のみ）
- [ ] GET/HEAD/OPTIONS の 5xx は引き続き再送する
- [ ] AI プロバイダー両方で適用される

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `defaultShouldRetry` のメソッド別判定テスト
- `OpenAIProvider`/`GeminiProvider` の再送動作テスト
- 5xx 応答のモックテスト

## 実装アプローチ
- **Outside-In**: AI プロバイダーの再送テストから始める
- **Red-Green-Refactor**: メソッドを受け取る `shouldRetry` シグネチャに変更

## 見積もり
2pt

## 技術的考慮事項
- `RetryOptions.shouldRetry` のシグネチャ変更が呼び出し元に影響
- 冪等性トークンを導入する場合はプロバイダー側の対応が必要

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "defaultShouldRetry\|fetchWithRetry" src/utils/fetch.ts
grep -n "fetchWithRetry" src/background/ai/providers/*.ts
```

### 実装手順
1. `RetryOptions` に `method` を渡す
2. `defaultShouldRetry` で POST/PUT/PATCH の 5xx をスキップ
3. 各プロバイダーのカスタム `shouldRetry` も更新

### 落とし穴
- ネットワーク層のエラー（fetch 例外）は再送してよい
- レスポンスステータスを持つ 5xx だけが対象

## 関連情報（graphify 調査結果）
- **関連ファイル**: `src/utils/fetch.ts`, `src/background/ai/providers/OpenAIProvider.ts`, `src/background/ai/providers/GeminiProvider.ts`, `src/utils/aiLimits.ts`
- **関連する過去PBI**: 該当なし
- **補足**: `fetchWithRetry` は `response.ok` が false の 5xx を `Error` に変換して throw するため、`OpenAIProvider`/`GeminiProvider` 内の `if (!response.ok)` 分岐は死にコードとなっている。本PBIと合わせて整理する。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] リファクタリング完了
