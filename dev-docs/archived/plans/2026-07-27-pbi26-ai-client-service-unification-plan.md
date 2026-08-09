# PBI-26: AIClientとAIServiceの二重抽象化を統一する 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Source PBI:** `pbi/2026-07-26-26-refactor-ai-client-service-unification.md`（フェーズ0再調査済み・2026-07-27）

**Goal:** `AIClient`と`AIService`のどちらを正とするかの方針をADRとして明文化し、`@deprecated`マークを追加する。呼び出し元は既に大部分が`AIService`型のみに依存しているため、実際のコード変更は最小限で済む見込み。

**Architecture:** 調査の結果、「並立する二重抽象化」ではなく「`AIService`が`AIClient`をラップするアダプター構造」が既に確立されている（`RemoteAIService`が`AIClient`インスタンスを内部に保持し、`FallbackAIService`が`LocalAIService`+`RemoteAIService`を束ねる）。したがって統一方針は**「AIServiceに統一し、AIClientはProviderロジックの内部実装として温存する」**一択となる。

**Tech Stack:** TypeScript, Vitest

---

## 事前調査で判明した呼び出し元の分類（2026-07-27確認、Task 1着手前の再確認は不要なほど明確）

`aiClient.ts`/`ai/AIService.ts`をimportする全11ファイルを分類済み:

**グループA: `AIClient`を実体としてimport（インスタンス化・配線コード、4ファイル）**
- `src/background/ServiceWorkerContext.ts`（`import { AIClient } from './aiClient.js'`、`AIService`型もimport）
- `src/background/createBackgroundServices.ts`（`import { AIClient } from './aiClient.js'`）
- `src/background/reviewSummaryGenerator.ts`（`import { AIClient } from './aiClient.js'`）
- `src/background/service-worker.ts`（`import { AIClient } from './aiClient.js'`）

**グループB: `AIService`型のみをimport（ビジネスロジック層、実体を知らない。6ファイル全て`import type`）**
- `src/background/pipeline/steps/processPrivacyPipelineStep.ts`
- `src/background/pipeline/RecordingPipeline.ts`
- `src/background/handlers/messageHandlers.ts`
- `src/background/pipeline/types.ts`
- `src/background/privacyPipeline.ts`
- `src/background/recordingLogic.ts`

**グループC: `aiClient.ts`から表示用の定数・型のみimport（機能とは無関係、2ファイル）**
- `src/dashboard/dashboard.ts`（`PROVIDER_LABELS`, `MultiProviderTestResult`）
- `src/dashboard/panels/diagnostic/diagnosticsPanel.ts`（`PROVIDER_LABELS`）

**この分類が示すこと**: ビジネスロジック層（グループB）は既に100%`AIService`型のみに依存している。実際に`AIClient`の実体を必要とするのはグループA（インスタンス化・配線コード）のみ。つまり「呼び出し元の完全移行」は当初懸念したほど大規模ではなく、グループAの4ファイルの構造を確認し、ADRで方針を確定させれば十分。

---

## Task 1: AIClient/AIServiceの機能比較とADR作成（必須）

**Files:**
- Create: `dev-docs/ADR/2026-07-27-ai-client-service-unification.md`

- [ ] **Step 1: グループAの4ファイルでAIClientがどう生成・使用されているか確認する**

```bash
grep -n "AIClient\|RemoteAIService\|FallbackAIService\|LocalAIService" src/background/ServiceWorkerContext.ts
grep -n "AIClient" src/background/createBackgroundServices.ts
grep -n "AIClient" src/background/reviewSummaryGenerator.ts
grep -n "AIClient" src/background/service-worker.ts
```

`createBackgroundServices.ts`が`AIClient`をインスタンス化し、それを`RemoteAIService`のコンストラクタに渡し、`FallbackAIService`でラップして`AIService`として配線しているか（あるいは異なる配線パターンか）を正確に把握する。

- [ ] **Step 2: `reviewSummaryGenerator.ts`が`AIService`ではなく`AIClient`を直接使っている理由を確認する**

```bash
grep -n "AIClient\|generateSummary" src/background/reviewSummaryGenerator.ts
```

週次/月次サマリ生成が`AIService`インターフェース（`generateSummary(content, options)`）で表現できない何か（例: 複数ページの一括要約、特殊なプロンプト）を必要としているか確認する。もし`AIService`で代替可能なら、これもグループBに含められる候補になる。

- [ ] **Step 3: `Strategy`実装（`providers/`配下）が`AIClient`側にのみ存在する構造を確認する**

```bash
grep -n "^export" src/background/ai/providers/ProviderStrategy.ts src/background/ai/providers/GeminiProvider.ts src/background/ai/providers/OpenAIProvider.ts
grep -n "providers\." src/background/aiClient.ts | head -10
```

`AIService`側（`RemoteAIService`, `LocalAIService`, `FallbackAIService`）がStrategyパターンを持たず、単に「`AIClient`に委譲するか、ローカル要約するか」の分岐のみであることを再確認する。

- [ ] **Step 4: ADRを作成する**

```bash
mkdir -p dev-docs/ADR
```

`dev-docs/ADR/2026-07-27-ai-client-service-unification.md`に以下の構成で記録する:

```markdown
# ADR: AIClientとAIServiceの統一方針

## ステータス
承認済み

## コンテキスト
Checking Team レビューでAIClientとAIServiceの二重抽象化が指摘された。調査の結果、
既に「AIServiceがAIClientをラップするアダプター構造」が確立されていることが判明した。

## 決定
**AIServiceに統一する。AIClientはProviderロジック（Gemini/OpenAI Strategy実装）の
内部実装として温存し、新規の呼び出し元はAIService経由でのみAI機能にアクセスする。**

## 呼び出し元の現状分類
（Task 1 Step 1-3の調査結果を転記）

## 影響範囲
- グループA（4ファイル）: 変更不要、既存の配線を維持
- グループB（6ファイル）: 既にAIService型のみに依存、変更不要
- グループC（2ファイル）: PROVIDER_LABELS等の表示用定数のみ、機能的にはaiClient.tsから
  読み込み続けて問題ない（Strategyの実装詳細ではなく単なる定数のため）

## 今後の方針
- 新しいAIプロバイダー統合やAI機能追加は、AIServiceインターフェースの拡張を通じて行う
- aiClient.tsへの新規の直接依存（グループAへの追加）は原則禁止する
- reviewSummaryGenerator.tsがAIClientを直接使っている件は、Task 1 Step 2の調査結果次第で
  別PBIとしてAIService移行を検討する
```

Task 1 Step 2の調査結果に応じて、`reviewSummaryGenerator.ts`の扱い（AIServiceへ移行するか、AIClient直接利用を正当な例外として明記するか）を確定させてADRに記録すること。

---

## Task 2: 廃止予定側への非推奨マーク追加（該当する場合のみ）

**Files:**
- Modify: `src/background/aiClient.ts`（該当メソッドのみ、クラス全体は非推奨にしない）

**方針転換の理由**: Task 1のADRで「AIClientはProviderロジックの内部実装として温存」と結論づけたため、`AIClient`クラス自体を`@deprecated`にするのは誤り（現役の内部実装のため）。代わりに、**グループA以外から新規に`AIClient`を直接importすることを防ぐ**ための軽量な仕組みを検討する。

- [ ] **Step 1: ADRの結論に応じて対応を決定する**

Task 1で「AIClientは内部実装として温存」と確定した場合、`AIClient`クラスへの`@deprecated`マークは追加しない。代わりに、クラス冒頭のJSDocコメントに以下を追記するのみに留める:

```typescript
/**
 * AIClient
 * Strategyパターンによるプロバイダー拡張
 *
 * ⚠️ 新規コードからの直接利用は避けること。AI要約機能へのアクセスは
 * src/background/ai/AIService.ts（AIServiceインターフェース）経由で行う。
 * AIClientはRemoteAIService内部でProviderロジックの実装として使われる。
 * 詳細: dev-docs/ADR/2026-07-27-ai-client-service-unification.md
 *
 * 【拡張性】: 新しいAIプロバイダーを追加する際はproviderConfigsに設定を追加するのみ
 * 【OCP Compliance】: 既存コードを修正せずに新しいプロバイダーを追加可能
 */
export class AIClient {
```

- [ ] **Step 2: lintルールでの強制は本Taskのスコープ外とする**

PBI本文は「`@deprecated`タグ、lintルール等」を提案しているが、AIClientを非推奨にしない結論となったため、lintルールでの新規import禁止は本PBIでは実施しない（将来的にESLintの`no-restricted-imports`ルールで`aiClient.js`の直接importを禁止する場合は、グループAの4ファイルを許可リストに追加する必要があり、別PBIとして起票する）。

---

## Task 3: reviewSummaryGenerator.tsのAIService移行検討（Task 1の調査結果次第、条件付き）

**Files（Task 1 Step 2の結果次第で実施要否を判断）:**
- Modify: `src/background/reviewSummaryGenerator.ts`（AIService移行する場合のみ）

- [ ] **Step 1: Task 1 Step 2で「AIServiceで代替可能」と判断された場合のみ着手する**

`reviewSummaryGenerator.ts`の`AIClient`直接利用箇所を、`AIService`インターフェース経由の呼び出しに置き換える。既存の`RemoteAIService`をそのまま注入する形にする。

- [ ] **Step 2: 既存テストを確認し、移行後も回帰しないことを確認する**

```bash
find src/background/__tests__ -iname "*reviewSummary*"
npm test -- reviewSummaryGenerator
```

**注記**: Task 1で「AIClient直接利用が正当な例外」と判断された場合、本Taskはスキップし、ADRにその理由を明記するのみでよい。

---

## 全体検証

- [ ] `npm run type-check` が成功する
- [ ] `npm test` で全テストがパスする
- [ ] ADRが`dev-docs/ADR/`に作成されている
- [ ] `pbi/00-INDEX.md` の該当行を更新する

## コミット方針

Task単位で個別コミットする:
1. `docs(adr): AIClient/AIService統一方針を決定しADRを作成`（Task 1）
2. `docs(ai): AIClientクラスに新規利用非推奨のJSDocコメントを追加`（Task 2）
3. `refactor(background): reviewSummaryGeneratorをAIService経由に移行`（Task 3、実施する場合のみ）

## 見積もりメモ

フェーズ0再調査で「AIServiceは既にAIClientのアダプター構造」と判明したため、当初懸念された
「呼び出し元の大規模移行」は不要。実質的な作業はADR作成（Task 1）が中心で、コード変更は
JSDocコメント追加程度に収まる見込み。PBI本文の見積もり（3pt以上）に対し、実際の作業量は
下限（1〜2pt相当）に近い可能性が高い。
