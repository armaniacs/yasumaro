# PBI: Obsidian 接続確認 GET の指数バックオフ再試行

## ユーザーストーリー

Obsidian と Yasumaro を接続するユーザーとして、一時的なネットワーク揺らぎや Obsidian Local REST API の短い障害が発生しても、指数バックオフで安全に再試行してほしい。なぜなら「接続できない」と誤表示されて接続設定を中止することを防ぎたいから。

## ビジネス価値

- 一時的な通信断、timeout、5xx を再試行することで、接続設定の中止を減らす。
- 認証失敗、認可失敗、リソース不在、設定不備は再試行対象にしないため、再試行による遅延を避けながら失敗原因を区別できる。
- 一時的な障害から回復した接続確認と、再試行しても回復しない接続確認を自動テストで検証できる。

## 優先度

- 順位: 04 / 30
- RICEスコア: 4.0（Reach=2 / Impact=1 / Confidence=100% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Feature: Obsidian 接続確認の一時的な障害への耐性

  Scenario: 最初の接続確認が成功する
    Given Obsidian Local REST API が接続確認要求に応答できる状態である
    When ユーザーが接続確認を実行する
    Then 接続成功の結果が返る
    And 追加の接続確認要求は送信されない

  Scenario: 通信断の後に Obsidian が応答する
    Given 最初の接続確認要求が connection reset で失敗する状態である
    And 後続の接続確認要求が成功する状態である
    When ユーザーが接続確認を実行する
    Then 接続成功の結果が返る
    And 再試行が指数バックオフの待機時間を挟んで実行される

  Scenario: timeout の後に Obsidian が応答する
    Given 最初の接続確認要求が timeout で失敗する状態である
    And 後続の接続確認要求が成功する状態である
    When ユーザーが接続確認を実行する
    Then 接続成功の結果が返る

  Scenario: 再試行可能な 5xx の後に Obsidian が応答する
    Given 最初の接続確認要求が 5xx で失敗する状態である
    And 後続の接続確認要求が成功する状態である
    When ユーザーが接続確認を実行する
    Then 接続成功の結果が返る
    And 各再試行の間には指数的に増加する待機時間が設けられる

  Scenario: 認証失敗を再試行しない
    Given 接続確認要求が 401、403、または 404 を返す状態である
    When ユーザーが接続確認を実行する
    Then 認証または応答の失敗に対応する既存の結果が返る
    And 接続確認要求は 1 回だけ送信される

  Scenario: 設定または実行環境の問題を再試行しない
    Given API key の欠落、非 loopback host の平文 HTTP、設定不備、または CSP block が発生する状態である
    When ユーザーが接続確認を実行する
    Then 既存の設定または実行環境の失敗に対応する結果になる
    And 接続確認要求は再試行されない

  Scenario: 再試行上限に達した接続確認を失敗として返す
    Given すべての接続確認試行が connection reset または timeout で失敗する状態である
    When ユーザーが接続確認を実行する
    Then 認証失敗と区別できるネットワーク失敗の結果が返る
    And 試行は設定した最大回数で終了する

  Scenario: Obsidian への書き込み経路を変更しない
    Given Obsidian への日常ノート書き込みで通信エラーが発生した状態である
    When 書き込み処理を実行する
    Then 既存の単発 PUT または read-modify-write の扱いから外れた再試行は発生しない
    And GET、section insert、full-note PUT の全体 replay は発生しない
```

## 受け入れ基準

- [ ] 接続確認の最初の GET が成功した場合は、追加要求を送らずに成功を返す。
- [ ] connection reset、timeout、再試行可能な 5xx は、明示した上限まで指数バックオフで再試行できる。
- [ ] 各試行の間には単調増加する指数バックオフの待機時間を設ける。
- [ ] 再試行上限に達した場合は、認証失敗と区別できるネットワーク失敗として扱う。
- [ ] 401、403、404 は再試行せず、既存の認証または応答失敗として扱う。
- [ ] API key 欠落、非 loopback host の平文 HTTP、設定不備、CSP block は再試行しない。
- [ ] retry は `testConnection()` の安全な root GET に限定する。
- [ ] 読み取り GET 以外、全体書き込み PUT、`appendToDailyNote()` の GET、section insert、full-note PUT には retry を追加しない。
- [ ] API key は Authorization header 以外へ送出せず、log、例外、通知へ含めない。
- [ ] 既存の timeout 処理と CSP fetch path を維持する。
- [ ] すべての ESM import は `.js` 拡張子を使う。
- [ ] `MessageRouter.ts` の production adapter call site から追加設定なしで同じ接続確認動作を利用できる。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- `MessageRouter.ts` の production adapter 経由で `testConnection` を呼び出し、一時的な接続障害の後に成功するユーザーシナリオを検証する。
- 認証失敗と設定失敗が既存の接続確認結果として返り、追加通知や追加 UI イベントが発生しないことを検証する。
- Obsidian への書き込み要求が、この retry の影響を受けないことを検証する。

### 統合テスト

- `src/background/__tests__/obsidianClient.test.ts` の接続確認正常系、401、403、404、500、timeout、network failure、URL error redaction の既存ケースを再試行仕様に合わせる。
- connection reset または timeout の後に成功する連続した fetch 応答を注入し、成功までの要求回数とバックオフ待機を検証する。
- 5xx の後に成功する連続した fetch 応答を注入し、対象 status だけが再試行されることを検証する。
- `obsidianClient-secure-fetch.test.ts` で Authorization header と CSP fetch path を維持することを検証する。
- `obsidianClient-body-timeout.test.ts:155-171` と timeout 処理の関連テストで、既存 timeout 動作を壊さないことを検証する。

### 単体テスト

- connection reset、timeout、再試行可能な 5xx を retryable として分類することを検証する。
- 401、403、404、API key 欠落、設定不備、CSP block を terminal error として分類することを検証する。
- 最大試行回数とバックオフの単調増加を fake timers で検証する。
- API key が retry 対象の log、例外、通知に含まれないことを検証する。
- retry 上限到達時の network failure と、認証失敗が別の結果になることを検証する。

## 実装アプローチ

1. `testConnection()` の安全な root GET の Outside-In 失敗テストを先に追加する。
2. retryable 条件を明示的な述語にまとめ、`testConnection()` 内だけで利用する。
3. 初期バックオフ、最大試行回数、対象 status 集合を `ObsidianClient` のクライアント定数として固定する。failure taxonomy が実装済みなら、述語は shared SSOT を参照してよいが、存在を前提にしない。
4. 既存の `fetchWithTimeout()` と CSP fetch path を維持し、retryable な結果だけ指数バックオフ後に同じ安全な GET を実行する。
5. 成功、terminal error、retry 上限のそれぞれで従来の結果型とエラー分類を維持する。
6. 書込経路と全体の replay には手を入れない。

## 見積もり

0.5 SP

## 技術的考慮事項

- 対象 HTTP surface は、読み取り GET、全体書き込み PUT、接続確認 GET の 3 種のみである。PATCH、POST、DELETE は追加しない。
- `testConnection()` の safe root GET だけを retry 対象にし、他の GET へ無差別に広げない。
- generic な network error だけで retry せず、connection reset、timeout、明示した 5xx を個別に判定する。
- retry 述語は status ごとに明示し、401、403、404 を broad な server error 判定へ含めない。
- backoff は有限回数・有限待機にし、service worker の存続を前提にしない。
- retry 中の例外を握り潰さず、認証失敗、設定失敗、CSP block を network failure に変換しない。
- API key は Authorization header の入力としてのみ扱い、retry metadata や診断情報へ含めない。
- timeout handler が `AbortError` の name または cause を失う既知の経路があるため、retry 判定が単一の error property に依存しないようにする。
- `src/utils/fetch.ts:147-154` と `src/utils/obsidianConfigValidator.ts:247-249` の既存の timeout 経路を変更する場合は、同一の abort 挙動を保持することをテストで固定する。
- 非 loopback host の平文 HTTP は既存 validator で拒否し、retry 側でも到達させない。

## 実装者向け注記

### 現状コードの確認

- HTTP surface は 3 種のみである。読み取り GET は `src/background/obsidianClient.ts:159-176`、全体書き込み PUT は `src/background/obsidianClient.ts:186-207`、接続確認 GET `/` は `src/background/obsidianClient.ts:238-276` にある。
- `testConnection()` は安全な root GET だが、`src/background/obsidianClient.ts:238-244` の単発 `fetchWithTimeout()` を使っている。
- production adapter call site は `src/background/handlers/MessageRouter.ts:175,178` の 2 箇所である。
- `appendToDailyNote()` は `src/background/obsidianClient.ts:121-153` で GET、section insert、full-note PUT の read-modify-write を mutex 実装済みである。
- 非 loopback host の平文 HTTP は `src/utils/obsidianConfigValidator.ts:35-66` で既に拒否されている。
- 既存テストは `src/background/__tests__/obsidianClient.test.ts`、`src/background/__tests__/obsidianClient-secure-fetch.test.ts`、`src/background/__tests__/obsidianClient-mutex.test.ts`、`src/background/__tests__/obsidianClient-body-timeout.test.ts:155-171` に存在する。
- 接続確認 GET の retry は現状未実装であり、本 PBI の対象は `testConnection()` に限定する。

### 実装手順

1. `obsidianClient.test.ts` に、初回成功、connection reset、timeout、5xx、認証失敗、terminal error、retry 上限の Outside-In テストを追加する。
2. 既存の 500 を即失敗とするテストを、対象 status の retry ケースと terminal status の即時失敗ケースへ分割する。
3. 初期バックオフと最大試行回数をクライアント定数として定義し、対象 status 集合を述語として明示する。
4. `testConnection()` の既存 `fetchWithTimeout()` 呼び出しだけを retry wrapper で囲み、CSP fetch path と timeout を維持する。
5. 書込メソッドと `appendToDailyNote()` を確認し、retry 処理が流入していないことを確認する。
6. API key が header、log、例外、通知のいずれにも意図しない経路で現れないことを確認する。

### 落とし穴

- 既存の `obsidianClient.test.ts` は 500 を即失敗として pin している可能性がある。retry 対象 status を明示してからテストを分割する。
- timeout handler は `AbortError` の name または cause を失う場合があるため、`error.name` だけを retry 判定に依存させない。
- `TypeError` を一括して network failure とすると、CSP block や設定不備まで再試行する可能性がある。retryable な接続断だけを明示する。
- broad な catch は API key を含む URL や header を例外へ漏らす危険があるため、既存 URL error redaction の検証を維持する。
- 指数バックオフの待機中に unresolved timer を残すと、テストや service worker の lifecycle を不安定にする。待機は確実に完了させる。
- PUT の再送を追加すると、同じ body の二重書き込みや read-modify-write の重複更新につながる。retry 実装を共通化せず connection check の呼び出し方に限定する。
- failure taxonomy の実装を前提にすると、本 PBI 全体が不要に block される。shared SSOT は任意参照とする。

## 決定事項

- backoff の初期値、最大試行回数、対象 status code 集合は `ObsidianClient` のクライアント定数として固定する。
- 対象 status は再試行可能な 5xx のみとし、401、403、404 を除外する。
- 初期遅延値と最大試行回数の正確な数値は、調査で値が指定されていないため実装時に決定し、fake timers のテストで固定する。
- failure taxonomy が存在する `pbi/2026-09-25-11-refactor-structured-failure-taxonomy.md` の完了を dependency とせず、retry 述語だけがその shared SSOT を参照する。
- 書込 replay の冪等化は `pbi/2026-09-25-13-investigate-obsidian-write-replay-idempotency.md` で扱い、本 PBI は先行できる。
- retry 回数を利用者向け通知、log、UI イベントには追加しない。既存の通知機構を再利用せず、内部テストで試行回数を検証する。
- ネットワーク失敗と認証失敗を区別して返す。generic な retry exhausted error に API key を含めない。

## Definition of Done

- [ ] BDD の全シナリオが Outside-In の自動テストとして実装され、green である。
- [ ] connection reset、timeout、対象 5xx だけが有限回数の指数バックオフ再試行対象である。
- [ ] 401、403、404、API key 欠落、CSP block、設定不備は再試行されない。
- [ ] retry 上限到達時は認証失敗と区別できるネットワーク失敗として扱われる。
- [ ] `testConnection()` 以外の HTTP surface と `appendToDailyNote()` の read-modify-write は変更されない。
- [ ] API key が Authorization header 以外、log、例外、通知へ漏れない。
- [ ] 既存 timeout、CSP fetch path、URL error redaction のテストが green である。
- [ ] すべての追加 import が ESM 規約に従い `.js` 拡張子を持つ。
- [ ] retry 回数を利用者向け通知、log、UI イベントに追加していない。
- [ ] failure taxonomy と書込 replay の PBI を dependency として追加していない。
- [ ] 関連する型チェック、lint、test の検証が完了している。
