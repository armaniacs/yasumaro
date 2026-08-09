# PBI: AIService に testConnection を追加し抽象の穴を閉じる

**作成日**: 2026-08-08
**優先度**: 高
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟡軽微（AI接続テスト経路の変更。実機検証要）
**種別**: 🔧非機能追加（refactor）

---

## 背景

アーキテクチャレビュー（2026-08-08、候補2）で、ADR 2026-07-27 が定めた「`AIService` に統一、`aiClient` への新規直接依存は原則禁止」が**構造的に守れない**ことが判明した。

`AIService` インターフェースに `testConnection` が存在しない：

```typescript
// src/background/ai/AIService.ts:25-28（実測・全文）
export interface AIService {
  generateSummary(content: string, options?: AISummaryOptions): Promise<AISummaryResult>;
  getSupportedModes(): AISummaryMode[];
}
```

そのため service-worker は要約と接続テストで**2つの経路を使い分けざるを得ない**：

```typescript
// src/background/service-worker.ts（実測）
323:  testAi: () => aiClient.testConnection(),
334:  testConnection: (onProgress, runId) => aiClient.testConnection(onProgress, runId),
```

これは呼び出し側の不注意ではなく**抽象の欠落**である。ADR が禁じた直接依存が、ADR の想定通りに書こうとしても回避できない。

### なぜこれを優先するか（実証済みの根拠）

同セッションで Gemini の thinking トークンバグ（commit `69c90c0`）を修正した際、**接続テストと本番要約の両方に同じ修正を別々に当てる必要があった**。これは偶然ではなく、2経路が独立して育った構造の帰結である。穴を閉じれば、この種の「片方だけ直る」事故が構造的に起きにくくなる。

### 併せて発見した実バグ

`RemoteAIService` が `success` / `error` を転送していない：

```typescript
// src/background/ai/RemoteAIService.ts:23-37 — success/error を返さない
// src/background/ai/LocalAIService.ts:33-34 — success/error を返す
// src/background/ai/FallbackAIService.ts:25 — localResult.success === false で分岐
```

`FallbackAIService` の `auto` 分岐は `success === false` を判定するが、remote 結果は常に `success: undefined` として読まれる。`undefined === false` は `false` なので、**remote が失敗しても失敗として扱われない**。

### 削除テスト

`RemoteAIService` 単体を削除すると、フィールド改名処理が呼び出し側へ散る → **複雑度が移動するだけ**。よって削除はしない。
一方 `AIService` に `testConnection` を**足す**方向は、2経路を1本に集約する純増の深化 → **複雑度が集中する**。

---

## 実装者向け注記: 現状の確認

```bash
# AIService の実装3つ
ls src/background/ai/{Remote,Local,Fallback}AIService.ts

# aiClient.testConnection の呼び出し元
grep -rn "aiClient.testConnection\|\.testConnection()" src/ --include="*.ts" | grep -v __tests__

# AIClient.testConnection のシグネチャ
grep -n "testConnection" src/background/aiClient.ts
```

---

## 設計

### AIService インターフェースの拡張

```
┌──────────────────────────────────────────────┐
│  AIService (interface)                       │
├──────────────────────────────────────────────┤
│  generateSummary(content, options?)          │
│  getSupportedModes()                         │
│  testConnection(onProgress?, runId?)  ← 追加 │
└──────────────────────────────────────────────┘
        △              △              △
        │              │              │
  RemoteAIService  LocalAIService  FallbackAIService
   aiClient へ委譲   ローカル判定    両者を束ねる
```

### 各実装の testConnection の扱い

| 実装 | 振る舞い |
|---|---|
| `RemoteAIService` | `aiClient.testConnection(onProgress, runId)` へ委譲 |
| `LocalAIService` | ローカルAI（Ollama等）の到達性を返す。既存の到達性判定を流用 |
| `FallbackAIService` | remote を委譲（接続テストはリモート設定の検証が目的のため） |

`LocalAIService` の扱いは実装時に既存コードを読んで決める。ローカル専用の到達性判定が無い場合は、リモートへ委譲する形で `AIService` の契約を満たす（接続テストUIはリモートプロバイダ設定の検証が目的）。

---

## 受け入れ基準（BDD）

```gherkin
Scenario: AIService 経由で接続テストできる
  Given AIService インターフェースに testConnection が定義されている
  When service-worker が aiService.testConnection() を呼ぶ
  Then aiClient を直接参照せずに接続テストが実行される

Scenario: RemoteAIService が success/error を透過する
  Given aiClient.generateSummary が success: false, error: "..." を返す
  When RemoteAIService.generateSummary を呼ぶ
  Then 戻り値に success: false と error が含まれる

Scenario: FallbackAIService の auto 分岐が remote 失敗を検出する
  Given mode が auto で、remote が success: false を返す
  When generateSummary を呼ぶ
  Then remote の失敗が失敗として扱われる（undefined として無視されない）

Scenario: 既存テストが全てパスする
  When 変更を完了する
  Then npm run validate が成功する
```

## 受け入れ基準

- [x] `AIService` インターフェースに `testConnection` を追加
- [x] `RemoteAIService` / `LocalAIService` / `FallbackAIService` の3実装に `testConnection` を実装
- [x] `RemoteAIService.generateSummary` が `success` / `error` を透過
- [x] `service-worker.ts` の `aiClient.testConnection` 2箇所を `aiService` 経由に置換
- [x] `RemoteAIService` の success/error 透過を検証する単体テストを追加
- [x] `FallbackAIService` の auto 分岐が remote 失敗を検出することを検証する単体テストを追加（既存テストに加え `testConnection` の委譲先も検証）
- [x] ADR 2026-07-27 に追記（Group C に `aiTestResultView.ts` を追加、`testConnection` 追加の経緯と実バグ）
- [x] `npm run validate` が成功する（7431 tests pass）

### 実装結果（2026-08-08）

- `AIService.ts`: `AiTestProgress` / `AiProviderTestResult` / `AiConnectionTestResult` 型を定義し、`aiClient.ts` に依存せず自立させた
- `LocalAIService.testConnection` はオンデバイスモデルの `getAvailability()` を使う（到達先が無いため「接続」= モデル利用可否）。`getAvailability` を持たないクライアントでも失敗結果を返して落ちない
- `service-worker.ts` の `aiClient` 参照はインスタンス生成のみに縮小（ADR グループAの配線用途）
- テスト 7424 → 7431（+7）

## テスト戦略

### 単体テスト
- `RemoteAIService`: `success: false` / `error` の透過（**回帰テスト**：現状は落ちるべき）
- `FallbackAIService`: auto モードで remote が失敗した場合の分岐
- 各実装の `testConnection` が委譲先を正しく呼ぶこと

### 回帰テスト
- 既存の `service-worker.test.ts`（TEST_AI / TEST_CONNECTIONS ハンドラ）
- 既存の `aiClient.test.ts`

## 実装アプローチ

1. `RemoteAIService` の success/error 透過を**先に**修正し、回帰テストを追加（バグ修正を独立させる）
2. `AIService` に `testConnection` を追加
3. 3実装に `testConnection` を実装
4. `service-worker.ts` の2箇所を置換
5. ADR 2026-07-27 に追記
6. `npm run validate`

## 見積もり
1pt（インターフェース拡張 + 3実装 + 呼び出し元2箇所 + テスト）

## 技術的考慮事項

- `AIClient.testConnection` は `onProgress` コールバックと `runId` を取る。進捗通知は `aiTestProgressNotifier.ts` 経由でブロードキャストされるため、委譲時にシグネチャを保つ必要がある
- `LocalAIService` に接続テストの概念が無い場合、無理に実装せずリモート委譲とする（YAGNI）
- ADR 2026-07-27 は「`AIClient` 全体の `@deprecated` は誤り」と明記している。本PBIは `AIClient` を削除せず、`AIService` を唯一の入口にするだけ

## 関連

- アーキテクチャレビュー（2026-08-08）候補2
- ADR: `dev-docs/ADR/2026-07-27-ai-client-service-unification.md`
- 先行修正: commit `69c90c0`（Gemini thinking バグ。本PBIの動機）
- 対象: `src/background/ai/AIService.ts`, `{Remote,Local,Fallback}AIService.ts`, `src/background/service-worker.ts`
