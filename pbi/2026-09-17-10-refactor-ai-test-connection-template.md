# PBI: AI プロバイダー接続テストのテンプレ化と providerCatalog の設定キー SSOT 化

優先度: 順位 10 / 10（RICE: 1.07 = Reach 4 / Impact 1 / Confidence 0.8 / Effort 3 pt）
backlog: [2026-09-17-00-backlog-arch-review-0917.md](2026-09-17-00-backlog-arch-review-0917.md)（台帳）
依存: pbi/2026-09-17-01-fix-ai-provider-test-label.md を先に完了すること（同一 testConnection 関数を触るため）

## ユーザーストーリー
拡張機能を保守する開発者として、AI プロバイダーの接続テストの重複実装をテンプレートに集約し、設定キーの定義を providerCatalog に一本化してほしい、なぜなら重複したテスト手順と二重管理された設定キーは修正漏れと表示・挙動のドリフトを生むから。

## 背景（現状と課題）
- `GeminiProvider` の `testConnection` 内と `GenericOpenAICompatibleProvider` の `testConnection` 内が同一シーケンスを約90パーセント重複している。順序はリクエスト構築から `fetchWithRetry`（maxRetryCount 1・500ms 開始・2倍・3000ms cap）による送信、`mapConnectionError` による HTTP エラー変換、`readJsonCapped` による応答読み取り（上限付き）、debug 情報組み立て（prompt・response・error・hasContent・statusCode・availability 系）まで共通であることを両ファイルの読み取りで確認した。
- `providerCatalog` のカタログエントリが `contentCharsKey` を宣言しているが、実行時には消費されていない。リポジトリ内の `contentCharsKey` の参照はカタログの宣言とカタログ適合テストのキー存在確認のみであり、プロバイダー実装からの参照はないことを検索で確認した。
- 実際の設定キー参照は各プロバイダー側にハードコードされている。`GeminiProvider` の要約フロー内の `contentLimit` 相当の処理が `StorageKeys.GEMINI_CONTENT_CHARS` を、`GenericOpenAICompatibleProvider` の上限取得処理が `StorageKeys.OPENAI_CONTENT_CHARS` を直接指定していることを両ファイルの読み取りで確認した。カタログ側を変更してもプロバイダー実装が変わらないドリフトの温床になっている。
- なお `baseUrlKey`・`apiKeyKey`・`modelKey`・`defaultBaseUrl`・`defaultModel`・`isLocal` については `GenericOpenAICompatibleProvider` のコンストラクタ内がカタログエントリ経由で読み取っていることを確認した。一方 `GeminiProvider` のコンストラクタ内はカタログを参照せず `StorageKeys` を直接参照していることを読み取りで確認した。すなわち未消費なのは主に `contentCharsKey` であり、カタログ全体が未消費というわけではない。
- `ProviderStrategy` の基底クラス内には `executeHttpSummaryFlow` と hooks 構造が既に存在し、要約フローはテンプレート化済みであることを読み取りで確認した。接続テスト側には対称のテンプレートがまだない。
- legacy provider id の互換扱いは `GenericOpenAICompatibleProvider` のコンストラクタ内の unknown provider フォールバックに住んでいる。カタログに載らない ID を正規化してキー名を組み立てる処理であることを読み取りで確認した。この扱いをカタログ側に移すか現状維持とするかの判断と記録が本 PBI の範囲に含まれる。
- 戦略生成の単一シームは `providerCatalog` 内の `createProviderStrategy` であり、`RemoteAIService` のコンストラクタ付近が全 ID をこの関数に委譲していることを読み取りで確認した。`aiServiceFactory` 自体は Local・Remote・Fallback の合成責務であり、プロバイダー分岐を持たないことを読み取りで確認した。

## BDD受け入れシナリオ
```gherkin
Scenario: 接続テストをテンプレに統合しても成功・失敗・debug 構造が同一である
  Given gemini と lm-studio の接続テスト
  When 両 testConnection を executeHttpTestFlow に統合する
  Then 成功・失敗・debug 構造が統合前と同一であり既存テストが無変更で green である

Scenario: カタログの contentCharsKey 変更がプロバイダーの切り詰め上限に反映される
  Given カタログで contentCharsKey を変更した状態
  When プロバイダーを再構築する
  Then プロバイダーの切り詰め上限がカタログの値に追従する
```

## 受け入れ基準
- [ ] `ProviderStrategy` の基底クラス内に `executeHttpTestFlow(hooks)` が新設され、既存 `executeHttpSummaryFlow` と対称の Template Method になっている
- [ ] `GeminiProvider` の `testConnection` と `GenericOpenAICompatibleProvider` の `testConnection` が新テンプレートに委譲し、重複シーケンスがプロバイダー側に残っていない
- [ ] 各 provider の `testConnection` の返り値（success・message・elapsedMs 扱い・debug の構造）と接続テストの挙動（`fetchWithRetry` のパラメータ、文言）が現行と完全一致する
- [ ] `providerCatalog` の `contentCharsKey` 等の宣言フィールドが実消費に昇格し、`createProviderStrategy` がカタログエントリをプロバイダーへ渡す形になっている
- [ ] legacy provider id（openai2 等）の互換扱いがどこに住むかを判断し、その決定を PBI またはコード内の非履歴コメントとして記録した
- [ ] プロバイダー関連の既存テストが無変更で green である
- [ ] `npm run type-check` が green である

## テスト戦略
- 既存スイートの無変更パスを parity の証拠とする。対象は `providers` 配下の `GeminiProvider` 系テストおよび `OpenAIProvider` 系テストと、`ai` 配下の `providerCatalog` 適合テスト・`RemoteAIService` 系テスト・`aiServiceFactory` 系テストである。
- parity 用に `fetchWithRetry` をモックした成功・HTTP エラー・例外の各経路で、統合前後の返り値（success・message・debug 構造）を比較するテストを追加する。文言の変更は本 PBI の範囲外とし、差分が出たら統合側を直す。
- SSOT 化の pin として、カタログの `contentCharsKey` を差し替えてプロバイダーを再構築したときに切り詰め上限が追従することを検証するテストを追加する。既存のカタログ適合テスト（キー存在確認）は維持する。

## 見積もり
3 pt。内訳はテンプレ新設と両 `testConnection` の委譲が 2 pt、カタログ SSOT 昇格と legacy 扱いの判断記録が 1 pt。

## 実装ガイド
- 新設する `executeHttpTestFlow(hooks)` は既存 `executeHttpSummaryFlow` と対称にする。hooks は `buildRequest` と `extractResponse` 相当の2点を中核とし、共通側が `fetchWithRetry` 方針・`mapConnectionError` 変換・`readJsonCapped` 読み取り・debug 組み立て・例外の `parseAndMapFetchError` 変換を所有する。
- hooks 案（命名は着手時に調整可）:
  - `buildRequest`: URL・headers・payload の組み立てのみを担う。Gemini 側のモデル名検証や URL 検証の癖はこの中に閉じ込める。
  - `extractResponse`: JSON パース済みデータから `success`・`message`・`debug` への変換のみを担う。Gemini 側の空応答文言分岐と OpenAI 側の choices 判定はこの中に閉じ込める。
  - 共通側に置くもの: リトライ方針（maxRetryCount 1・初回 500ms・2倍・上限 3000ms）、HTTP 非成功時の `mapConnectionError` 呼び出しと prompt・endpoint・statusCode の付加、成功時の `readJsonCapped` 呼び出し、例外時の `parseAndMapFetchError` 呼び出しと prompt・endpoint の付加。
- プロバイダー差分の扱い:
  - プロバイダーラベルは引数化し、ハードコードを残さない。依存 PBI で `this.providerName` 渡しに直した箇所と競合させないこと。
  - Gemini 側の資格なし・モデル名不正・URL 検証失敗の早期リターンは `buildRequest` の前段または `checkCredentials` 相当の hook に寄せ、テンプレートの順序を壊さない。
- カタログ SSOT 昇格案:
  - `createProviderStrategy` が解決済みカタログエントリをプロバイダーへ渡す形にする。`GeminiProvider` のコンストラクタが `StorageKeys.GEMINI_CONTENT_CHARS` を直接掴んでいる箇所と、`GenericOpenAICompatibleProvider` の上限取得処理が `StorageKeys.OPENAI_CONTENT_CHARS` を直接掴んでいる箇所を、渡されたエントリの `contentCharsKey` 経由に置き換える。
  - `apiKeyKey`・`modelKey`・`defaultModel`・`defaultBaseUrl` については OpenAI 系では既にエントリ経由であることを確認済みのため、Gemini 側を含めて不足分だけを寄せる。余分な抽象化は追加しない。
  - legacy の unknown フォールバック（ID 正規化によるキー組み立て）は、削除ではなく置き場所の判断と記録に留める。カタログに載せるとドロップダウン順序や適合テストに波及するため、着手時に影響を確認すること。
- 制約の再掲: 返り値構造と接続テスト挙動の完全一致を守り、既存テスト無変更 green を目標とする。文言改善は別 PBI に切り出す。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
