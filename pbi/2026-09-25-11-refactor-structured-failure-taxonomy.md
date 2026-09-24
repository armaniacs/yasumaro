# PBI: 構造化 failure taxonomy の SSOT 化

種別: refactor

## ユーザーストーリー

一時的なネットワーク障害、タイムアウト、認証エラー、レート制限、設定不備を区別して扱いたいユーザーと、それによって無駄な再試行や誤った通知を受ける運用担当者として、Recording 処理の失敗理由を安定した構造化 kind で把握できるようにしたい。そのため、AI、Obsidian、HTTP transport の各境界から同じ failure metadata を StepExecutor と retry policy まで届かせ、sanitized なユーザー向けメッセージは維持したい。

## ビジネス価値

- 一時的な接続障害と、認証・設定・レート制限のような即時再試行が適さない障害を区別できる。
- Obsidian の実際の network error や timeout が誤って offline 扱いになる運用上の盲点を解消できる。
- failure kind ごとの retry ポリシーを downstream PBI とテストで共有でき、将来の挙動変更を局所化できる。
- API key、response body、summary 本文を技術 metadata に保持せず、運用上の診断性と秘密情報の分離を両立できる。

## 優先度

順位: 11 / 30
RICEスコア: 1.6（Reach=3 / Impact=2 / Confidence=80% / Effort=3 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: Obsidian の実際の接続障害を network として扱う
  Given Obsidian への接続が transport 層で失敗する
  When Recording の失敗を StepExecutor が retry policy に渡す
  Then failure kind は network になる
  And 既存の接続障害ユーザー向けメッセージは保持される
  And failure metadata に API key や response body が含まれない

Scenario: AbortError を timeout として保持する
  Given Obsidian request が body read の timeout で中断される
  When 現在の transport と Obsidian の error 境界が failure を返す
  Then failure kind は timeout になる
  And 通常の network error と区別できる
  And timeout metadata が retry policy に渡る

Scenario: Obsidian write の HTTP 応答を安全に分類する
  Given Obsidian PUT が 401、403、429、または 5xx を返す
  When failure kind と retry 資格を決定する
  Then 401 と 403 は auth になる
  And 429 は rate_limit になり、即時 retry と offline retry の対象外になる
  And 5xx は http になり、同一 request 内の再送を行わない

Scenario: 全 AI provider の失敗を構造化して StepExecutor へ届ける
  Given RemoteAIService で利用可能な全 provider が失敗する
  And 失敗には技術 metadata と隔離された sanitized message が存在する
  When privacyPipeline が AI 結果を StepExecutor へ渡す
  Then 既存の summary result の扱いを維持したまま failure kind を参照できる
  And API key、response body、summary 本文が failure metadata に含まれない

Scenario: 即時回復を期待できない失敗を offline retry へ送らない
  Given failure kind が auth、rate_limit、configuration、または csp である
  When shouldEnqueueForOffline が実行される
  Then offline retry は開始されない
```

## 受け入れ基準

- [ ] SSOT に `network`、`timeout`、`http`、`auth`、`rate_limit`、`configuration`、`csp` の 7 kind が定義されている。
- [ ] 同じ kind と意味の重複定義が retry policy、AI、Obsidian、fetch の各実装へ存在しない。
- [ ] 構造化 kind を持つ入力では、sanitized message の部分文字列一致を retry 判定に使用しない。
- [ ] fetch transport、Obsidian error、AI result の 3 境界が failure metadata を StepExecutor まで保持する。
- [ ] `AbortError` に基づく timeout が `network` と区別され、Obsidian 境界で新規 Error へ変換される際の metadata 損失がない。
- [ ] HTTP 401 と 403 は `auth`、429 は `rate_limit`、5xx は `http` に分類される。
- [ ] 429 は即時 retry と offline retry の対象外である。
- [ ] POST、PUT、PATCH、DELETE の 5xx は同一 request 内で再送しない。`docs/EXTERNAL_API_RELIABILITY_GUIDELINE.md:80-102` の既存方針を維持する。
- [ ] `http` の delayed offline recovery は method ごとの追加判断を要するものとして、この PBI では自動 offline retry 対象に含めない。
- [ ] `auth`、`rate_limit`、`configuration`、`csp` は offline retry 対象にしない。
- [ ] `network` と `timeout` は offline retry の判断に利用できる。
- [ ] ユーザー向け sanitized message の既存文言は、failure kind 導入後も parity を保つ。
- [ ] failure metadata は構造化 kind と安全な技術情報だけを持ち、API key、response body、summary 本文、raw provider error を含まない。
- [ ] 既存 result と exception の外部的な扱いを不必要に変えず、StepExecutor が両方の failure carrier を正規化できる。
- [ ] `classifyError()` は SSOT の分類結果を再利用し、独立した message substring 判定の SSOT にはしない。
- [ ] legacy message fallback が必要な箇所では、fallback の利用範囲が明示され、新規境界が message を契約として生成しない。
- [ ] `MAX_PROVIDERS` の値は変更しない。
- [ ] async/await、ESM import の `.js` 拡張子、Manifest V3 の制約を維持する。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- Recording の一つの代表経路で、実際の境界実装から生成した failure を StepExecutor と retry policy まで通す。
- network または timeout が発生した場合に recovery 対象の判定が kind に従い、既存ユーザー向けメッセージが変わらないことを確認する。
- auth または rate_limit が発生した場合に offline retry と誤った通知が発生しないことを確認する。

### 統合テスト

- `src/background/pipeline/__tests__/` に、ObsidianClient、RemoteAIService または ProviderStrategy、StepExecutor、RetryPolicy を実装修でつなぐ contract test を置く。
- Obsidian の network error、body timeout、PUT の 401、403、429、5xx を実 client の error 変換経路から生成し、RetryPolicy までの kind と retry 資格を検証する。
- 全 provider failure の summary result が privacyPipeline と StepExecutor の境界で failure metadata を保持し、summary 本文が metadata に混入しないことを検証する。
- `src/background/pipeline/__tests__/retryPolicy.test.ts`、`stepExecutor.test.ts`、`RecordingPipeline-offline-policy.test.ts`、AI provider、`httpSummaryFlow`、ObsidianClient の既存テストを新しい契約に合わせて更新する。
- 既存テストが前提とする sanitized message の文言 parity を明示的に検証し、failure kind の変更と表示文言の変化を分離する。

### 単体テスト

- SSOT の各 kind、HTTP status からの分類、timeout name の扱い、原因 metadata の保持を検証する。
- `auth`、`rate_limit`、`configuration`、`csp` が offline retry 対象にならないこと、429 が rate_limit に閉じて同じ扱いになることを検証する。
- POST、PUT、PATCH、DELETE の 5xx で同一 request の再送が発生しないことを検証する。
- `network` と `timeout` の offline retry 資格、および `http` の method 別判断を本 PBI 内で自動化しない境界を検証する。
- API key、response body、summary 本文を含む文字列が failure metadata に保存されないことを検証する。
- `classifyError()` が SSOT へ委譲し、message substring 判定を重複して持たないことを検証する。

## 実装アプローチ

1. Outside-In で、StepExecutor と RetryPolicy が実境界由来の structured failure を使えることを示す contract test を先に失敗させる。
2. 7 kind と安全な metadata、kind 単位の retry 資格を所有する SSOT を追加する。
3. fetch transport の `AbortError` を.timeout metadata に正規化し、Obsidian の network と timeout 変換で kind、status、method、安全な cause を保持させる。
4. ObsidianClient の PUT 401、403、429、5xx を対応する kind へ分類し、同一 request の再送を維持する。
5. ProviderStrategy の status metadata と RemoteAIService の全 provider failure summary に structured failure を保持させ、privacyPipeline と StepExecutor の既存分岐を維持する result または exception の carrier を正規化する。
6. RetryPolicy を structured kind を正とする契約へ移行し、message fallback を互換境界へ隔離する。
7. 既存 sanitized message parity と secret 非混入を検証してから、7 kind、3 境界、policy 単位の単体テストを追加する。
8. グリーン後に重複変換，消除可能な fallback、result と exception の重複 carrier を整理する。

## 見積もり

3 SP

## 技術的考慮事項

- 依存関係: なし。完了後の downstream は `pbi/2026-09-25-12-fix-offline-recovery-single-owner.md`、`pbi/2026-09-25-15-investigate-ai-provider-circuit-breaker.md`、`pbi/2026-09-25-13-investigate-obsidian-write-replay-idempotency.md` が本 PBI の SSOT を参照する。
- 正となる契約: structured failure metadata であり、sanitized message ではない。message は表示用途に限定する。
- carrier の境界: thrown Error と result summary のどちらも domain 上の failure を保持できるが、StepExecutor は両方を同じ正規化関数へ通してから retry 資格を判断する。
- 技術 metadata の範囲: HTTP status、HTTP method、failure kind、安全に正規化した cause 等の診断に必要な情報だけを許可する。
- secret の分離: raw provider error、API key、response body、summary 本文を metadata にコピーしない。
- 5xx の安全性: server での処理完了が応答損失と区別できないため、unsafe method の同一 request 再送を禁止する。delayed offline recovery の method 別採用可否は本 PBI の外で決定する。
- 429 の扱い: `rate_limit` へ正規化し、その kind 自体を即時 retry と offline retry の対象外にする。
- Service Worker: failure や retry 状態を Service Worker の実行時変数へ保持せず、既存の storage、alarm、pipeline state を通す。
- 非機能要件: retry 判定の overhead を小さく保ち、既存 API call 回数とユーザー向け表示の parity を維持する。
- `MAX_PROVIDERS`: `src/background/ai/RemoteAIService.ts:55` の定数と provider 集約方針を維持する。

## 実装者向け注記

### 現状コードの確認

- `src/background/pipeline/retryPolicy.ts:15-40` の `shouldEnqueueForOffline()` は production の retry 判断を所有し、`src/background/pipeline/stepExecutor.ts:53` が production consumer である。
- 実際に throw し得るステップは `privacyPipeline` と `saveObsidian` であり、`extractSentences` は内部 catch 後に fallback する。
- `retryPolicy.ts:33-35` は原因を遡るが、message dependency を除去してはいない。
- `src/utils/fetch.ts:147-154` は timeout error に `name = "AbortError"` を設定する。
- `src/background/ai/providers/ProviderStrategy.ts:24-47` は `debug.statusCode` を保持する。
- `src/utils/obsidianConfigValidator.ts:241-252` は network error を文言へ変換し、`:247-249` は timeout を新規 Error にする。
- `src/background/obsidianClient.ts:196-205` は PUT の 401、403、5xx を同一の接続確認メッセージへ変換する。
- `src/background/ai/RemoteAIService.ts:167-172` は全 provider failure を summary error result として返す。
- `src/background/privacyPipeline.ts:247-301` はその summary error を通常の cloud result として扱う。
- `src/utils/errorClassification.ts:80-123` の `classifyError()` は message substring 判定であり、単独再利用だけでは message dependency を除去できない。

### 実装手順

1. 7 kind と kind 単位の retry policy を test-first で確定する。
2. structured metadata の入力 contract と、throw または result から failure を取得する正規化 interface を SSOT として実装する。
3. fetch と Obsidian の network、timeout を SSOT に接続し、metadata の loss と表示文言の変化を contract test で確認する。
4. ObsidianClient の HTTP status を `auth`、`rate_limit`、`http` へ分類する。
5. AI provider と RemoteAIService の aggregate result に metadata を保持し、privacyPipeline と StepExecutor が同じ failure を参照できるようにする。
6. RetryPolicy を structured kind 優先へ切り替え、既存 test と message parity を更新する。
7. secret 非混入、7 kind、3 境界、unsafe 5xx、429、legacy fallback の範囲をテストで固定する。

### 落とし穴

- 既存テストの message 文言への依存を、taxonomy 導入と同じ変更で削除すると、表示 parity の回帰を検出できない。
- `RemoteAIService` の全 provider failure を一律 throw にすると、`privacyPipeline.ts:247-301` の既存分岐と result 契約が変わる。failure metadata を正とし、throw と result の carrier を明示的に扱う。
- timeout 用の新規 Error に旧 Error を渡さないと、`AbortError`、原因、HTTP metadata が失われる。
- 429 を単純な `http` のまま扱うと retry 資格が曖昧になるため、必ず `rate_limit` へ正規化する。
- 5xx を持つ unsafe method を connection failure として再分類すると、同一 request の再送による危険が生じる。
- raw Error、response body、summary を `cause` や debug metadata へ丸ごとコピーすると、sanitized message とは別の情報漏えい経路になる。
- legacy message fallback を SSOT として残すと、新規の境界が message coupling を再導入する。fallback は structured metadata が存在しない互換入力だけに限定する。

## 決定事項

1. RetryPolicy の正となる契約を sanitized message ではなく structured failure kind とする。message substring は新規 contract として禁止し、既存文言は parity test だけで保証する。
2. failure の伝播元は status、timeout name、method、cause の安全な正規化結果とし、sanitized message とは別 field に保持する。3 境界は SSOT と同じ metadata を渡す。
3. thrown Error と summary result のどちらも transport carrier として認め、domain の正となる値は structured failure とする。RemoteAIService の全 provider failure result を一律 throw へ変えず、StepExecutor が両 carrier を正規化する。
4. 実 client と provider を RetryPolicy までつなぐ contract test は pipeline の統合テストへ置き、boundary 固有の変換は各境界の単体テストで固定する。
5. enqueue policy は `network` と `timeout` を対象とし、`auth`、`rate_limit`、`configuration`、`csp` と `http` はこの PBI では対象外とする。429 は必ず `rate_limit` に閉じる。legacy message fallback は構造化 kind を持たない互換入力だけに限定し、新境界では利用しない。method 別の delayed offline recovery は別 PBI の決定事項とする。

## Definition of Done

- [ ] SSOT に 7 kind が定義され、重複した kind 定義がない。
- [ ] fetch transport、Obsidian error、AI result から StepExecutor まで structured failure が保持される。
- [ ] `network`、`timeout`、`auth`、`rate_limit`、`http`、`configuration`、`csp` の BDD シナリオと境界条件が自動テスト化されている。
- [ ] 429 が即時 retry と offline retry の対象外であることをテストが保証する。
- [ ] unsafe method の 5xx が同一 request 内で再送されないことをテストが保証する。
- [ ] 実 client と provider が生成する error を RetryPolicy まで通す contract test がある。
- [ ] 既存 sanitized message の parity が検証され、ユーザー向け表示が変わっていない。
- [ ] failure metadata に API key、response body、summary 本文、raw provider error が含まれないことをテストが保証する。
- [ ] 既存テストが新しい taxonomy と parity 契約に合わせて更新されている。
- [ ] 型チェックと全テストが成功し、async/await、ESM `.js` import、Manifest V3 の制約を満たしている。
- [ ] `MAX_PROVIDERS` が維持されている。
- [ ] downstream PBI が参照できる SSOT と retry policy が文書化されている。
