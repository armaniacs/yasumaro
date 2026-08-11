# PBI: review summaryをAIServiceへ移行する

## 実装状況

**完了** — 2026-08-11。review summaryのAIService factory注入、alarm/message共有、AIClient直接生成除去、ADR更新を実装済み。

## 親PBI

`2026-08-11-01-architecture-deepening-epic.md`

## ユーザーストーリー

開発者として、review summary生成が`AIClient`を直接生成せず、既存のAIService interfaceを利用するようにしたい。これにより、provider挙動、token policy、error handlingのlocalityを高め、AI機能を同じinterface越しにテストしたい。

## スコープ

- `reviewSummaryGenerator`の`AIClient`直接生成を解消する。
- 既存の`AIService` interfaceをreview summary経路へ注入する。
- weekly summaryとmonthly summaryを対象にする。
- Service Worker、alarm、dashboardの呼び出し経路を必要な範囲で整理する。
- `AIClient`をprovider implementationとして内部に残す。
- summary出力、token計測、sanitization、error handlingを維持する。
- offscreen document lifecycleの所有権を明確にした上で移行する。

## 非スコープ

- 新しいAI providerの追加
- `AIClient` implementationの削除
- `AIService` interfaceの大規模変更
- summary promptや出力形式変更
- AI token policy変更
- offscreen document実装全体の刷新
- review summary以外の呼び出し経路再設計

## 依存関係

子PBI 4完了後に開始する。AIServiceとoffscreen document lifecycleの所有権を確認し、既存ADRの例外を再検討してから実装する。

## 受け入れ条件

```gherkin
Scenario: weekly summaryがAIServiceを利用する
  Given weekly summary生成が要求される
  When summaryを生成する
  Then review summary generatorはAIService interfaceを利用する
  And AIClientを直接生成しない
  And 既存のsummary内容と出力形式が維持される

Scenario: monthly summaryがAIServiceを利用する
  Given monthly summary生成が要求される
  When summaryを生成する
  Then review summary generatorはAIService interfaceを利用する
  And providerの選択と設定は既存のcomposition root方針に従う
  And 既存のsummary内容と出力形式が維持される

Scenario: provider failureを統一的に扱う
  Given AIServiceがprovider failureを返す
  When review summaryを生成する
  Then 既存のsummary error handlingが適用される
  And provider固有のimplementation詳細が呼び出し側へ漏れない
  And failureが空のsummaryや成功値へ変換されない

Scenario: offscreen lifecycleを維持する
  Given Service Workerまたはalarmからsummary生成が起動される
  When AIServiceがoffscreen documentを必要とする
  Then offscreen documentの生成、利用、終了は決定済みの所有者が管理する
  And Service Workerの再起動や終了後も不正な状態を残さない
  And 既存のMV3非同期message契約が維持される

Scenario: AIService fakeで検証する
  Given AIService fakeが注入されている
  When weeklyまたはmonthly summaryをテストする
  Then 実際のAIClientやproviderを生成せずにsummary生成を検証できる
  And 入力、prompt選択、出力変換、failure handlingを確認できる
```

## テスト観点

- weekly / monthly summaryのAIService注入
- 全呼び出し経路のcomposition
- AIService fakeによるprovider非依存テスト
- provider failure、timeout、retry
- token計測、summary sanitization
- 空入力と大量入力
- alarm起動、dashboard起動、Service Worker再起動
- offscreen document lifecycle
- AIClient直接生成の残存検出
- 既存AI provider integration tests

## 完了条件

- review summary generatorがAIClientを直接生成しない。
- weekly / monthly summaryがAIService interfaceを経由する。
- offscreen document lifecycleの所有者が明確である。
- AIService fakeでsummary経路を検証できる。
- 既存のsummary出力、token、sanitization、error handlingが維持される。
- AIClientは内部implementationとして残る。
- ADRの例外が解消または明示的に更新される。
- 親PBIの全体完了条件を満たせる。

## 実装結果

- review summary generatorをfactory化し、AIServiceとSQLite依存を注入した。
- weekly/monthly summary、alarm、message経路で同一generatorを利用した。
- AI用途はoffscreen非依存として整理し、関連ADRと設計文書を更新した。
- summary出力、fallback、token、sanitization、download契約を維持した。
- 関連テスト、type-check、validate、buildが成功した。
