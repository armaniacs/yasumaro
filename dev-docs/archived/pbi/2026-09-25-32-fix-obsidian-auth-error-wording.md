# PBI: Obsidian の 401/403 が認証エラーとして表示されるようにする

種別: fix

## ユーザーストーリー

Obsidian 連携を使っているユーザーとして、API キーが期限切れや入力ミスで 401/403 になったときに「インターネット接続を確認してください」と言われる状況をなくしたい。実際の原因は接続ではなく認証なので、誘導先が間違っている。

## ビジネス価値

- 認証失敗とネットワーク失敗の誘導先を分離し、ユーザーが誤った段階で時間を失うのを防ぐ。
- PBI 2026-09-25-11 が導入した構造化 failure kind を、表示側でも finally  megal に反映する。
- 日本語と英語の 4 メッセージが、乱立する_errorNetwork ではなく正しい案内を表示する。

## 優先度

- 順位: 32 / 32
- RICEスコア: —（PBI 2026-09-25-11 の裁定から統合担当が起票。個別 RICE 採点は未実施）

## 問題の事実（2026-09-26 実測）

`src/utils/errorClassification.ts` の `classifyError()` は **network 判定を最初に** 評価する。Obsidian のエラー文面は 401/403/404/429/5xx で共通で `Please check your Obsidian connection.` を含むため、常に `ErrorType.NETWORK` に落ち、後段の auth / not-found / rate-limit 分岐に到達しない。

結果として 401/403 が次を表示する:

| locale | キー | 表示 |
|---|---|---|
| ja | `errorNetwork` | ネットワークエラーが発生しました。インターネット接続を確認してください。 |
| en | `errorNetwork` | A network error occurred. Please check your internet connection. |

`errorAuth` は既に存在し、`public/_locales/{ja,en}/messages.json` に次で定義済み（**新しい i18n キーは追加しない**）:

| locale | キー | 表示 |
|---|---|---|
| ja | `errorAuth` | 認証エラーが発生しました。APIキーを確認してください。 |
| en | `errorAuth` | An authentication error occurred. Please check your API key. |

## なぜ PBI 2026-09-25-11 と同時に直さなかったのか

同 PBI の受け入れ基準は「ユーザー向け sanitized message の既存文言は parity を保つ」
「failure kind 導入と表示文言の変化を分離する」だった。

同 PBI の実装は当初 `classifyError()` を kind 起点に変更しており、これだと
Obsidian の 401/403・404・429・5xx の**4 つ**の表示が変わる。導入前の表示キーは
メッセージ文面に依存して決まっていたため、kind ごとに `ErrorType` を割り当てる方法では
parity を再現できない。統合担当がこれを検出し、表示経路を kind から切り離して
parity を回復した。

結果として表示と kind が**意図的に食い違う**状態が明示的な既知不具合として残る。
本 PBI がその修正を引き継ぐ。表示文言の変更はユーザーが目にする変更であり、
内部リファクタリングに紛れ込ませず、レビューとリリースノートを伴わせて行う。

## BDD受け入れシナリオ

```gherkin
Scenario: 401/403 が認証エラーとして表示される
  Given Obsidian の API キーが無効で PUT が 401 を返す
  When クライアントがその失敗を整形する
  Then 表示は errorAuth になる
  And ネットワーク接続の確認を指示しない

Scenario: 429 がレート制限として表示される
  Given Obsidian が 429 を返す
  Then 表示は errorRateLimit になる

Scenario: 5xx がサーバーエラーとして表示される
  Given Obsidian が 500 を返す
  Then 表示は errorServer になる

Scenario: ネットワーク障害は認証に誤認しない
  Given transport が TypeError を投げる
  Then 表示は errorNetwork のままである
  And auth へ分類されない

Scenario: 新しい文言の出現がない
  Given 既存の 4 キーがja/en で定義済みである
  When この修正を適用する
  Then 新しい i18n キーは追加されない
```

## 受け入れ基準

- [ ] `classifyError()` が構造化 kind を使うか、あるいは kind にアクセスできる形で
      Obsidian の 401/403 を `ErrorType.AUTH` に写す。
- [ ] 401/403 が `errorAuth` を表示する（ja/en とも）。
- [ ] 429 が `errorRateLimit`、5xx と 404 が `errorServer` を表示する。
- [ ] transport `TypeError` は `errorNetwork` のままで、auth に誤認しない。
- [ ] 新しい i18n キーを追加しない（`errorAuth` / `errorRateLimit` / `errorServer` は既存）。
- [ ] 英語・日本語の両 locale について parity を検証するテストを置く。
- [ ] PBI 2026-09-25-11 の「表示は kind に依存しない」不変条件テストを、
      本 PBI の裁定に合わせて更新する（両者は排他ではない）。
- [ ] `src/utils/errorClassification.ts` の `FAILURE_KIND_TO_ERROR_TYPE` が
      実行経路に戻されるか、変更的话は表と実装が食い違わないことを明記する。
- [ ] CHANGELOG にユーザー表示が変わることを記載する。
- [ ] `npm run type-check` と `npm run validate` が成功する。
- [ ] コードレビューが完了している。

## テスト戦略（t_wadaスタイル）

### 単体テスト

- Obsidian の 401/403/404/429/500/503 それぞれについて、ErrorType と
  `getErrorI18nKey()` の結果を固定する。
- 同じ taxonomy carrier で、表示变得更Dónde ないことを確認する。
- 既存の fallback sentence parity テストを維持する。

### 統合テスト

- 実 `ObsidianClient` から 401 を受けたとき、StepExecutor を経て
  `errorAuth` に到達すること。
- 既存の `obsidianClient-failureTaxonomy.test.ts`（PBI 11）が持つ
  「display と kind が食い違う」アサーションを、本 PBI の裁定で更新すること。

## 実装アプローチ

1. `classifyError()` の先頭に `resolveFailure()` による分岐を戻す。ただし
   **`csp` は `ErrorType.UNKNOWN` のまま**（既存の generic 文面を保つため）、
   **`timeout` と `network` は `NETWORK`**（変更なし）とする。
2. PBI 11 の分離不変条件テストを、本 PBI で意図的に変えた旨の記録へ更新する。
3. ja/en の parity を検証するテストを追加する。
4. CHANGELOG エントリを追加する。
5. 新しい i18n キーを追加しないことを確認する。

## 見積もり

0.5 SP

## 技術的考慮事項

- 本 PBI は**ユーザー表示が変わる**。レビューとリリースノートが必須。
- PBI 2026-09-25-11 の受け入れ基準「表示文言の parity を保つ」とは排他になる。
  意図的な変更であり、11 側の記録に本 PBI への引き継ぎが済んでいる。
- 401/403 の表示修正と 429/5xx の表示修正はOffsets だが同じ原因
  （network 分岐が先にある）を持つため、同時に直す。
- `errorAuth` は既存のキーであり、「401 unauthorized」を名指しするメッセージは
  すでに `ErrorType.AUTH` に到達していた。ユーザーの-api キー誤り経路の修正である。

## Definition of Done

- [ ] すべての受け入れ基準を満たす。
- [ ] Obsidian の 401/403 が `errorAuth` を表示する。
- [ ] 429 と 5xx がそれぞれ `errorRateLimit` と `errorServer` を表示する。
- [ ] transport 障害は `errorNetwork` のままである。
- [ ] 新規 i18n キーは 0 件である。
- [ ] ja/en parity を検証するテストがあり green。
- [ ] `npm run type-check` と `npm run validate` が PASS。
- [ ] CHANGELOG にユーザー表示変更として記載している。
- [ ] コードレビューが完了している。
- [ ] **未実施（ユーザー作業）**: GitHub PR レビュー、実機での表示確認。
