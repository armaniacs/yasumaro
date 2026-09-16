# ADR: built-in AI 二重アダプタの裁定 — LocalAIService と BuiltInAiProvider の併存

## ステータス
採用

## 日付
2026-09-17

## コンテキスト
同一の `BuiltInAIClient`（`src/background/builtInAIClient.ts`。Chrome Gemini Nano / Edge Phi-mini の
Prompt API を Service Worker から直接呼ぶクライアント）に、2つのアダプタが存在する。

1. `LocalAIService`（`src/background/ai/LocalAIService.ts`。`AIService` インターフェース実装）。
   `aiServiceFactory.ts` の `createAIService` が `FallbackAIService(local=LocalAIService, remote=RemoteAIService)`
   として組み立てる（`new LocalAIService({ localAiClient: builtInAiClient })`）。
   `getSupportedModes()` は `['local_only']` のみを返し、`generateSummary` は sanitize せず
   `BuiltInAIClient.summarize` に直結する。報告 provider 名は `'built-in-ai'`。
2. `BuiltInAiProvider`（`src/background/ai/providers/BuiltInAiProvider.ts`。`AIProviderStrategy` 実装）。
   冒頭に ADR-015 の Strategy-only 方針への準拠を明記し、内部で自前の `BuiltInAIClient` に委譲する。
   `providerCatalog.ts` の `built-in-ai` エントリ（`modelKey: ''`、`requiresApiKey: false`、
   `settingsBlockKind: 'built-in-ai'`）→ `createProviderStrategy('built-in-ai')` →
   `RemoteAIService` の provider 優先順位 slot loop から到達する。
   `sanitizeContent`・`recordUsageIfPresent` を内蔵し、`checkPreFlight`/`getMaxTokens` を意図的に
   スキップする（オンデバイス推論に課金・レート制限がないため）。

つまり built-in AI には「privacy mode の local として」と「provider スロットの1つとして」の
2つの入口がある。到達条件は直交する。`FallbackAIService.generateSummary` により
`local_only` は必ず local 側（`LocalAIService`）に落ち、slot loop を経由しない。
逆に `BuiltInAiProvider` は `RemoteAIService` 内にのみ存在し、`full_pipeline` / `masked_cloud`
経路でのみ到達する。`testConnection` の意味も異なる（`LocalAIService` はモデル availability 判定、
`BuiltInAiProvider` は実 summarize による疎通、`FallbackAIService` は remote へ委譲）。

二重化の経緯は歴史的なものである。2026-07-27 の AIClient・AIService 統一方針 ADR が扱ったのは
`AIClient` と `AIService` の二重抽象化であり、`LocalAIService` はその時点で既に
「ローカルAIを使う実装」として存在した。一方オンデバイス Prompt API クライアントの本格整備は
その後（`builtInAIClient.ts` 冒頭の 2026-07-30 Edge Phi-mini 実機検証コメント参照）であり、
`BuiltInAiProvider` は on-device モデルを Strategy 世界の slot として露出させるために後付けされた。
ADR-015（Strategy パターンによる provider 抽象化）と `LocalAIService` 経路の関係は、
どちらの追加時点でも明文化されなかった。

`AISummaryMode`（`full_pipeline` / `local_only` / `masked_cloud` / `auto`）と
PRIVACY_MODE タクソノミーの関係も未文書化だった。実コードの裏取りでは以下の対応である。
`privacyPipeline.ts` の `_buildSanitizedSettings` が privacy mode を
`useLocalAi`（`local_only`/`full_pipeline`）・`useMasking`（`full_pipeline`/`masked_cloud`/`local_only`）・
`useCloudAi`（`local_only` 以外）に分解し、local 段階は `aiService.generateSummary(..., { mode: 'local_only' })`
（`privacyPipeline.ts:194`、実呼び出しを自分で確認）、cloud 段階は常に `{ mode: 'full_pipeline' }` で呼ぶ。
すなわち `AISummaryMode` は AIService 内部のルーティング語彙であり、PRIVACY_MODE はその前段で
boolean 3つに分解される。分解ロジックは provider slot 名を一切参照しないため、二重表現に依存していない。
なお privacy 側の `masked_cloud` は AIService 側の `masked_cloud` 分岐を経由しない
（cloud 段階は常に `full_pipeline` で呼ぶ）。AIService 側の `masked_cloud` は
privacyPipeline 外からの直接呼び出し用にのみ生きている。

## 決定
統合しない。両者を併存させる。検討した統合案
（`local_only` モードを `built-in-ai` スロットの別名に解決する案）は不採用とする。

不採用の理由。local 経路のマスキング・安全性検査は `privacyPipeline.ts`
（`useMasking` による正規表現マスキング＋`_performLocalSummarization` の
`checkPromptSafety(local-input/local-summary)`）が担い、`LocalAIService` は素通しする設計である。
これを slot 側に寄せると「masking-before-local」保証の所在移転となり、
`useLocalAi`/`useMasking`/`useCloudAi` の組み立て、`local_only` の即時 return 契約
（`returnEarly`＋`local-ai-unavailable` pending 登録＋throw）、`testConnection` の意味
（availability 判定 vs 実 summarize）、`RemoteAIService` の slot loop 契約
（優先順位・`minLength` 再試行・重複排除・audit log）の再設計が必要になる。
得られる利益（`providerName` 表示の一本化程度）がコストを上回らない。

`LocalAIService` は削除不可である。`privacyPipeline.ts:194` の `_performLocalSummarization` が
mode `local_only` で `aiService.generateSummary(..., { mode: 'local_only' })` を実呼び出しし、
`FallbackAIService:21-23` 経由で必ず `LocalAIService` → `BuiltInAIClient.summarize` に落ちる。
削除は privacy mode `local_only` の即時破壊である。

## 結果
- 二重表現は歴史的経緯（時間差のある追加）の産物だが、現時点では privacy-mode ルーティング軸と
  provider-slot 選択軸の責務分離として機能している。ADR-015（Strategy-only）との関係は
  「`BuiltInAiProvider` が Strategy 側の顔、`LocalAIService` が AIService 側の local 専任」であり、
  2026-07-27 統一方針（新規呼び出し元は `AIService` 経由）と矛盾しない。
  両入口とも最終的に `AIService` 抽象の内側に収まっている。
- 維持条件: `LocalAIService` を `local_only` 専任・素通し（sanitize は privacyPipeline 側）に保つ。
  `BuiltInAiProvider` を slot 側の Strategy として保ち、`providerName: 'built-in-ai'` の一致を保つ。
  新規の built-in AI 到達経路は作らない。
- 統合を再検討するトリガー:
  1. `privacyPipeline` が slot ベースのルーティングに移行し、`_buildSanitizedSettings` の
     boolean 分解が不要になったとき。
  2. `LocalAIService` に sanitize/`recordUsage` の自前実装が必要になり、両アダプタの差分が
     `getSupportedModes` の違いだけになったとき。
  3. `testConnection` の意味（availability vs 疎通）の一本化が接続テスト UI の要件になったとき。
  いずれかが満たされたら本 ADR を置換する ADR を起票し、統合案を再評価する。
- privacyPipeline の mode 判定ロジックは二重表現に依存していない（slot 名を参照しない）。
  よって本裁定のためのコード変更は不要であり、実装変更が必要になった場合は後続 PBI として切り出す。
  本 PBI のスコープは調査・記録のみである。

## 参照
- `src/background/ai/LocalAIService.ts` — `local_only` 専任、`BuiltInAIClient.summarize` へ直結
- `src/background/ai/providers/BuiltInAiProvider.ts` — Strategy アダプタ、`sanitizeContent` 内蔵
- `src/background/builtInAIClient.ts` — 単一クライアント（Prompt API 直呼び）
- `src/background/ai/FallbackAIService.ts` — `local_only` 直結 / `full_pipeline`・`masked_cloud` は remote
- `src/background/ai/aiServiceFactory.ts` — `createAIService` 組み立て
- `src/background/ai/RemoteAIService.ts` — slot loop（`built-in-ai` はここからのみ到達）
- `src/background/ai/providerCatalog.ts` — `built-in-ai` エントリ、`createProviderStrategy`
- `src/background/privacyPipeline.ts` — `_buildSanitizedSettings`、`_performLocalSummarization`
- `dev-docs/ADR/2026-04-21-ai-provider-abstraction.md` — ADR-015 Strategy-only 方針
- `dev-docs/ADR/2026-07-27-ai-client-service-unification.md` — AIClient・AIService 統一方針
- PBI: `pbi/2026-09-17-07-investigate-builtin-ai-dual-adapter.md`
- 5 Whys: `/tmp/whywhy/pbi07-builtin-ai-dual-adapter.md`
