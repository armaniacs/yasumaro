# PBI 15 調査報告: AI プロバイダの跨リクエスト circuit breaker policy

PBI: `pbi/2026-09-25-15-investigate-ai-provider-circuit-breaker.md`（investigate・production code 変更なし）
依存: PBI 2026-09-25-11（structured failure taxonomy）は完了・アーカイブ済み。C28 の SSOT `src/utils/failureTaxonomy.ts` を入力契約として再利用する。
日付: 2026-09-27

## 1. 5 Whys（事実 → 裁定 → 根拠 → 残存リスク）

### Q1: なぜ障害中の provider に課金リクエストを送り続けるのか

- **事実**: `RemoteAIService.generateSummary` の fallback loop（`src/background/ai/RemoteAIService.ts:152-186`）は最大 10 スロット（`MAX_PROVIDERS = 10`、`:55`）を**無条件に**試す。health state は存在しない。provider 単体の transport retry（`ProviderStrategy.ts`、POST timeout 1 回・network 最大 3 回）により、1 スロットあたり理論上 4 wire requests、合計最大 40 wire requests に増幅する。
- **裁定**: provider × model の組合せ単位に circuit breaker（連続失敗 threshold → cooldown → lazy half-open probe）を置き、cooldown 中のスロットは試行対象から除外する。
- **根拠**: 障害継続中は transport retry の如何にかかわらず同じ失敗が再現する。除外しても fallback 候補が他にあれば要約は成功し続ける。
- **残存リスク**: cooldown 中に provider が回復した場合、probe まで遅延する（最大 cooldown 時間の要約遅れ）。half-open probe（§4）で軽減。

### Q2: なぜ記録をまたいで失敗が続くのか

- **事実**: provider health はどこにも保存されていない。SW はエフェメラルで、メモリ state は再生成のたびに消える。
- **裁定**: state は **chrome.storage.session** へ保存し、`SessionStorePort` 実装（buffered `SessionStore`）を経由する。key は `sw:aiProviderBreaker`。browser close で消える session-scoped 動作を前提とし、local backup へは入れない。
- **根拠**: session は SW lifecycle を跨ぎ、browser close で消える。provider 障害は browser session 内で完結する時間スケールであり、durable に残す必要がない（長期障害は testConnection で人間が診断する）。
- **残存リスク**: `SessionStore` の debounce write（50ms）は SW 終了時のデータ消失窓。breaker state 更新は必ず `flushImmediately: true` を使う（§6）。

### Q3: なぜ既存の limiter で防げないのか

- **事実**: `rateLimiter.ts` は origin policy、`aiUsageTracker.ts` は全体 quota、`SessionStore` は永続化基盤であり、いずれも provider health の責務を持たない。
- **裁定**: 新規 module `aiProviderBreaker`（`src/background/ai/providerBreaker.ts`、後続 fix で作成）に provider health policy を集約する。既存 3 モジュールに触れない。
- **根拠**: 責務の単一所有（SSOT）。origin policy と quota は provider の健康状態と独立した概念。
- **残存リスク**: 4 つの guard（breaker / rateLimiter / usageTracker / fallback loop）の相互作用が複雑化。後続 fix の契約に「非干渉テスト」を含める（§10）。

### Q4: なぜ failure class を裁定できないままだったのか

- **事実**: 依存 PBI 11 完了前は、AI 境界の status・name・cause が文字列 message に吸収されていた。現在は `FailureMetadata`（kind: network / timeout / http / auth / rate_limit / configuration / csp、status 付き）が `resolveFailure()` で構造化され、`RemoteAIService.processSummarySlot` は結果に `failure` を付与する（`:132-133`）。
- **裁定**: breaker の入力は `result.failure?.kind`（`FailureKindValue`）のみ。message・name・`debug.statusCode` の文字列照合は禁止。`failure` が付いていない失敗（例: min-length 未満の成功レスポンス）は breaker 入力にしない。
- **根拠**: taxonomy SSOT が 7 kind の境界を既に確定している。文字列照合は境界で壊れる。
- **残存リスク**: `http` kind は 4xx と 5xx を同じ kind に統合する。§3 の matrix は `failure.status`（1-9 行目の `FailureMetadata.status`）で 5xx と 4xx を区別する。

### Q5: なぜ実装前に決める必要があるのか

- **事実**: threshold・cooldown・half-open・reset・testConnection 扱い・並行 update 直列化のいずれも、誤ると「課金呼び出しの増加」か「過剰な除外（要約不能）」か「更新の取りこぼし」に直結する。
- **裁定**: 本報告書の §3〜§7 で全数値・契約を確定する。実装は後続 fix（3 SP 以上）に一括委譲し、本 PBI では production を変更しない。
- **根拠**: policy を実装と同時に決めると、実測なしの数値がコードに定着する。
- **残存リスク**: 数値は理論根拠付きの初期値であり、実運用での再調整が必要。§4 に再調整トリガーを記載。

## 2. スロット構造の確認（既存構造を二重定義しない）

| 項目 | 値 | 出典 |
|---|---|---|
| loop 上限（MAX_PROVIDERS） | 10 | `RemoteAIService.ts:55`（SSOT、変更しない） |
| built-in providers | 3 | RemoteAIService 内固定 |
| remote repository slots | 最大 7 | provider 設定（settings）由来 |
| 課金対象の外部呼び出し候補 | 最大 9 | built-in 3 + remote 7 − 無課金分の内訳。実測は後続 fix で `resolveProviderSlots` から取得し、ここでは policy の前提としてのみ記載 |
| provider 単体 retry | POST timeout 1 回 + network 最大 3 回（最大 4 wire requests / slot） | `ProviderStrategy.ts` |
| 合計理論上限 | 40 wire requests / summary call | 10 × 4 |

breaker はこの構造の**外側**で「スロットを試すかどうか」だけを裁定し、loop 上限・retry 回数・dedupe・single-flight は一切変更しない。

## 3. failure class matrix（breaker への入力裁定）

入力は `processSummarySlot` の返却 `result.failure`（`FailureMetadata`）のみ。matrix は 5 Whys Q4 の裁定を表にしたもの。

| FailureKind | status | 判定 | 根拠 |
|---|---|---|---|
| `network` | — | **加算** | provider エンドポイント到達不能。連続 3 回は障害と見なす |
| `timeout` | — | **加算** | サーバ応答なし。network と同様に連続で障害と見なす |
| `http` | 500-599 | **加算** | サーバ側障害。cooldown 中に回復する可能性が高い |
| `http` | 4xx（401/403/429 以外） | **加算**（但し threshold に到達しても cooldown は既定値） | リクエスト構造の問題は回復しないが、provider 側の暫定的なバグの場合がある。cooldown で一時隔離し、probe で回復検知 |
| `auth` | 401/403 | **加算・threshold 1・cooldown 15 分** | 無効 credential の cooldown 後再試行は無駄課金。probe（§4）でのみ回復検知し、ユーザーは testConnection で診断する |
| `rate_limit` | 429 | **加算・threshold 1・cooldown 10 分** | retry は throttling を深める（`FAILURE_RETRY_PROFILE` が offlineRecovery も禁止）。cooldown を長くして節流する |
| `configuration` | — | **無視**（加算しない） | 設定欠落はユーザー操作で即座に直る。cooldown に閉じ込めない |
| `csp` | — | **無視**（加算しない） | 同上。ホスト許可の設定問題 |
| （`failure` なし） | — | **無視** | min-length 未満の成功レスポンス等、分類不能な低品質応答は breaker に入力しない |
| `success` | — | **reset** | 連続失敗カウンタを 0 に戻し、openUntil をクリア |

breaker 判定に `failure` が付与されていない場合は無視する（Q4 裁定）。taxonomy から判定できない error は存在しない（`failure` なし = 判定不能 = 無視、という単純規則で malformed state とは区別する）。

## 4. parameter table（数値・根拠・再調整トリガー）

| パラメータ | 初期値 | 根拠 | 再調整トリガー |
|---|---|---|---|
| threshold（連続失敗回数） | 3 | 1 回は transport retry 内の変動、2 回は偶然、3 連続は障害のシグナル。40 wire requests 上限の内、障害中スロットで最大 12 wire requests（3 回 × 4）まで課金を許容 | 障害誤検知（回復直後の要約失敗）が観測されたら 2 に引き下げ |
| cooldown（既定） | 5 分 | 5 分 alarm と同程度の時間スケール。短すぎると節約効果が薄く、長すぎると回復遅延 | probe 成功率の観測後 |
| cooldown（auth） | 15 分 | credential 無効は即時回復しない | ユーザーが key を更新した直後の UX 不満が出たら testConnection 経由の reset を強化 |
| cooldown（rate_limit） | 10 分 | 429 は節流を意図した応答。5 分より長く抑える | 上流の rate limit ヘッダが利用可能になったら Retry-After 接続 |
| half-open probe 数 | 1（cooldown 経過後の最初の要約リクエストのみ試行） | probe 失敗 → cooldown 再開（同じ cooldown 長）、probe 成功 → reset。連続 probe は課金増加に直結するため 1 件のみ | probe が頻繁に失敗する場合（障害未回復での無駄課金）は probe 間隔（cooldown 再開長）を 2 倍へ指数退避 |
| success reset | 任意の success で failures = 0、openUntil 削除 | 1 回の成功は provider が完全に動作している証拠 | — |

half-open は **lazy evaluation のみ**：state に保存した `openUntil` timestamp と現在時刻の比較だけで試行可否を判定する。setTimeout・module-global timer・alarm は一切使わない（SW エフェメラル性に対する耐性）。

## 5. state key と value shape

```ts
// storage key: 'sw:aiProviderBreaker'（SESSION_KEYS に追加 — 後続 fix）
interface ProviderBreakerState {
  [providerModelKey: string]: ProviderBreakerEntry | undefined;
}
interface ProviderBreakerEntry {
  /** 連続 breaker failure 数（success で 0 にリセット） */
  failures: number;
  /** cooldown 開始時刻。cooldonn 中判定と probe 失敗の指数退避に使う */
  openedAt?: number;
  /** cooldown 終了時刻（エポック ms）。この時刻より後は half-open probe 許可 */
  openUntil?: number;
  /** 最後に cooldown を開いた failure kind（auth / rate_limit の長い cooldown を延長するため） */
  openedBy?: FailureKindValue;
}
```

- `providerModelKey` = `${provider}::${model}`（model 未設定時は `${provider}::default`）。**API key は絶対に含めない**。key と value・log・exception に認証情報を入れない。
- 欠落した state（初回）→ failures 0 として扱う。malformed な state（型不一致）→ 当該エントリを削除し failures 0 として扱う（fail-open: breaker の失敗で要約を止めない）。
- session は browser close で消える。durable backup への追加は行わない。

## 6. concurrency contract

- **直列化方式**: per-key（providerModelKey）の in-process promise chain。各 read-modify-write は前の更新の完了を待ってから storage.session を再読みする（SW は単一プロセスなので in-process 直列化で取りこぼしは生じない。ChromeStoragePort が structured clone 境界を持つため、read-modify-write は毎回 fresh read から始める）。
- **更新の消失防止**: read → modify → write を 1 つの serialized ステップに含め、外側で読んだ古い state を write しない。
- **state update 失敗時**: breaker update の失敗（storage quota、例外）はログのみで握りつぶし、**要約 fallback の実行自体は停止させない**。fail-open。breaker が「試行を省略する」機能であり、省略判定に失敗しても既存 loop が全スロットを試す現状動作にフォールバックする。
- 責務境界: `rateLimiter`（origin）・`aiUsageTracker`（全体 quota）・`SessionStore`（永続化基盤）に provider health を通さない。`sqliteAlert.ts` の直接 read/rehydrate 方式は採用しない（SessionStorePort 経由で統一）。

## 7. testConnection rule

- ユーザーが明示した診断操作なので **cooldown による skip を受けない**（試行省略なし）。
- 試験結果の state 反映は **bypass only**（結果を state に書かない）。理由: 手動試験の 1 回の失敗が自動 cooldown を引き起こすと、ユーザーの診断操作が要約の availability を変えてしまう。reset も手動試験からは行わない。
- cooldown 中でも testConnection は実際の wire request を送る。その結果で「breaker を解除する」必要がある場合は、次の要約リクエストが half-open probe を自然に実行する（lazy evaluation のため追加操作不要）。

## 8. 適用範囲

| 経路 | breaker 適用 | 備考 |
|---|---|---|
| `generateSummary` fallback loop（10 スロット） | **適用**（試行前 skip 判定 + 結果後の state update） | production consumers: `privacyPipeline.ts:153-166`、`reviewSummaryGenerator.ts:313-326` |
| `FallbackAIService.ts:52-60` の委譲 | 適用なし（委譲先で動く） | 下流は generateSummary と同一経路 |
| `retryObsidianWrite`（2-step subset） | 適用なし | AI を再実行しないため breaker 入力にならない |
| 接続試験 loop（`RemoteAIService.ts:211-246`、MessageRouter adapter 2 件 `:175,178`） | **skip なし**（§7 裁定） | 結果は state 反映しない |
| `pendingSqliteQueue.ts:76-110` | 適用なし（スコープ外明記） | AI を再実行しない |

in-flight dedupe（`RemoteAIService.ts:96-99`）と single-flight（`:300-307`）は維持。breaker state update を dedupe に代用しない（state update は fallback loop の結果点でのみ行い、同時リクエストは dedupe で 1 つの loop に集約されるため、二重 update は構造的に発生しない）。

## 9. compositionManifest 登録と test seam（後続 fix の受け入れ基準）

- `src/background/ai/providerBreaker.ts` を新設し、`src/background/compositionManifest.ts:75,106-107` に登録する（直接 import の test が通っても wiring が無ければ完了としない）。
- `SESSION_KEYS` に `AI_PROVIDER_BREAKER: 'sw:aiProviderBreaker'` を追加。
- state store は constructor injection（`SessionStorePort` を渡せる test seam）とし、module singleton にしない（ADR: module-singleton-policy に従い manifest から解決）。
- 新しい Chrome permission・`Promise.then` chain・拡張子なし ESM import は追加禁止。
- `MAX_PROVIDERS` を breaker module へ複製しない（SSOT 維持）。

## 10. 後続 fix への分解（3 SP 以上・垂直 slice）

後続 PBI 1 件（`fix`、3 SP）として切り出す:

1. **垂直 slice**: breaker module（threshold/cooldown/probe/reset の判定 pure 関数 + session persistence + per-key serialization）→ compositionManifest 登録 → `generateSummary` loop への skip 判定 + state update 配線 → testConnection への skip なし配線
2. **BDD test（Outside-In）**: PBI 15 の 5 シナリオをそのまま受け入れテストに変換（連続失敗での skip・他スロット非干渉・lazy half-open・testConnection bypass・taxonomy 契約・並行 update 直列化）
3. **非干渉回帰**: rateLimiter / aiUsageTracker / dedupe / single-flight / MAX_PROVIDERS の既存テストを green 維持
4. **切替条件**: 本報告書の §3 matrix と §4 parameter table を実装の正（SSOT）とし、数値変更はテーブルと一緒に行う

## 11. 受け入れ基準との対応（PBI 15 DoD）

- 依存 PBI 11 の完了と C28 SSOT 利用方針: §0（先頭）・§3 に記載 ✅
- 5 Whys（事実・裁定・根拠・残存リスク）: §1 ✅
- failure class matrix: §3 ✅
- threshold・cooldown・half-open・success reset・testConnection rule: §4・§7 ✅
- state は chrome.storage.session + browser close で消える前提: §2 Q2・§5 ✅
- API key 非包含: §5 ✅
- concurrency 直列化と state update 失敗時の fallback 継続: §6 ✅
- 要約 loop・接続試験・2 consumers・FallbackAIService・MessageRouter adapter の適用範囲: §8 ✅
- MAX_PROVIDERS・10 件・built-in 3・remote 7・外部候補 9・retry・dedupe・single-flight の維持: §2 ✅
- rateLimiter・aiUsageTracker・SessionStore との責務境界 + pendingSqliteQueue スコープ外: §6・§8 ✅
- compositionManifest 登録方針と test seam: §9 ✅
- 新 permission・module-global state・setTimeout・API key 漏出の禁止: §5・§9 ✅
- 後続 fix への変換: §10 ✅
- production code 変更なし: 本報告書は `dev-docs/plans/` のみ ✅
