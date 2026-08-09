# PBI: AI プロバイダ間の非対称な振る舞いを解消する

**作成日**: 2026-08-08
**優先度**: 中
**見積もり**: 🟡中（2pt目安）
**副作用**: 🔴あり（リトライ方針・使用量記録の変更。実プロバイダでの検証要）
**種別**: 🔧非機能追加（refactor）

---

## 背景

アーキテクチャレビュー（2026-08-08）で、`ProviderStrategy` 基底クラスは十分 deep（289行中約210行が共有ロジック）である一方、**同じ「AI要約」で provider 間の振る舞いが揃っていない**ことが判明した。

commit `2026-08-07-01`（provider 共通ロジック抽出）で error mapping・limit 解決は基底クラスへ寄せられたが、以下3点が残った。

### 1. リトライ方針が非対称

| Provider | `shouldRetry` |
|---|---|
| `OpenAIProvider.generateSummary` | 12行のカスタム述語を渡す（166-178行）。429 と非冪等5xx でリトライを抑止 |
| `GeminiProvider.generateSummary` | **渡さない**（114-119行）。デフォルトを継承 |

`maxRetryCount: 3, initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 60000` は同一だが**実挙動が異なる**。Gemini はレート制限（429）でもリトライしてしまう。

### 2. 使用量記録が非対称

| Provider | `usageMetadata` / `usage` 欠落時 |
|---|---|
| `OpenAIProvider._extractSummary`（309-311行） | `if (sentTokens !== undefined \|\| receivedTokens !== undefined)` → **記録しない** |
| `GeminiProvider`（350-354行） | `\|\| 0` で0に丸め → **必ず `recordUsage(0, 0)` を記録** |

使用量統計に provider 依存の歪みが入る。

### 3. BuiltInAiProvider が基底クラスの安全機構を通っていない

`BuiltInAiProvider.ts`（113行）は `AIProviderStrategy` を継承しているが、以下を**一切呼んでいない**：

- `checkPreFlight()` — ハードリミット / 使用量警告 / レート制限
- `sanitizeContent()` — **プロンプトインジェクション検出と高危険度ブロック**
- `getMaxTokens()` / `getMaxContentChars()` — 上限解決

継承は `aiClient.ts:99` のレジストリ契約を満たすためだけに行われており、`settings` フィールドは継承したまま未読。

**`sanitizeContent()` を通らないことはセキュリティ上の論点**である。Built-in AI（Chrome Gemini Nano / Edge Phi-mini）はオンデバイス実行のため外部送信は無いが、プロンプトインジェクションによる要約内容の汚染（誤った要約が Obsidian に書き込まれる）は起こりうる。

加えて `BuiltInAiProvider.ts` は**テスト0**。他3プロバイダは400-550行のテストを持つ。

### 削除テスト

3点いずれも「基底クラスへ寄せる」方向。`ProviderStrategy` は既に deep なので、寄せることで**複雑度が集中する**。

---

## 実装者向け注記: 現状の確認

```bash
# shouldRetry の非対称
grep -n "shouldRetry" src/background/ai/providers/*.ts

# recordUsage の呼び方
grep -n "recordUsage" src/background/ai/providers/*.ts

# BuiltInAiProvider が基底メソッドを使っているか
grep -n "checkPreFlight\|sanitizeContent\|getMaxTokens\|getMaxContentChars" src/background/ai/providers/BuiltInAiProvider.ts
# → 0件であることを確認

# 基底クラスの共有メソッド
grep -n "protected\|abstract" src/background/ai/providers/ProviderStrategy.ts
```

---

## 設計

### 1. リトライ述語を基底クラスへ

```
┌─────────────────────────────────────────────┐
│  AIProviderStrategy                         │
├─────────────────────────────────────────────┤
│  protected defaultShouldRetry(...)  ← 追加  │
│    429 → リトライしない                      │
│    非冪等 5xx → リトライしない               │
│    その他 5xx / ネットワーク → リトライ       │
└─────────────────────────────────────────────┘
        △                    △
  OpenAIProvider       GeminiProvider
   基底を利用            基底を利用（挙動が変わる）
```

`OpenAIProvider` の既存述語をそのまま基底へ移し、両者から利用する。

### 2. 使用量記録を基底クラスへ

```
protected recordUsageIfPresent(sentTokens?, receivedTokens?): void
  → 両方 undefined なら記録しない（OpenAI の挙動を採用）
```

**OpenAI 側の挙動を正とする理由**: `recordUsage(0, 0)` は「0トークン使った」という誤った事実を統計に混ぜる。トークン数不明は「記録しない」が正しい。

### 3. BuiltInAiProvider を安全機構に載せる

`sanitizeContent()` を通す。`checkPreFlight()` / `getMaxTokens()` は Built-in AI の性質を踏まえて判断する：

| 基底メソッド | Built-in AI での扱い |
|---|---|
| `sanitizeContent()` | **通す**（プロンプトインジェクション対策。オンデバイスでも要約汚染は起こる） |
| `checkPreFlight()` | 要検討。オンデバイスは API コストが無いためレート制限・使用量警告は不要の可能性 |
| `getMaxContentChars()` | 通す（オンデバイスモデルは context window が小さいため上限は必要） |
| `getMaxTokens()` | 要検討（Built-in AI API が maxTokens 相当を受け取るか実装で確認） |

`checkPreFlight` / `getMaxTokens` は「オンデバイスには不要」と判断できる場合、**通さない理由をコード内コメントに明記する**（次のレビューで同じ指摘が再発しないように）。

---

## 受け入れ基準（BDD）

```gherkin
Scenario: Gemini がレート制限でリトライしない
  Given Gemini API が HTTP 429 を返す
  When generateSummary を呼ぶ
  Then リトライせずにエラーを返す（OpenAI と同じ挙動）

Scenario: トークン数不明時に 0 を記録しない
  Given Gemini の応答に usageMetadata が含まれない
  When generateSummary を呼ぶ
  Then recordUsage が呼ばれない（0,0 を記録しない）

Scenario: Built-in AI がプロンプトインジェクション検査を通る
  Given 高危険度のプロンプトインジェクションを含むコンテンツ
  When BuiltInAiProvider.generateSummary を呼ぶ
  Then sanitizeContent によりブロックされる

Scenario: 既存テストが全てパスする
  When 変更を完了する
  Then npm run validate が成功する
```

## 受け入れ基準

- [x] リトライ述語を `ProviderStrategy.shouldRetrySummaryRequest` に移し、OpenAI / Gemini 両者が利用
- [x] 使用量記録を `ProviderStrategy.recordUsageIfPresent` に移し、両者が同じ条件で記録
- [x] `BuiltInAiProvider` が `sanitizeContent()` を通る
- [x] `BuiltInAiProvider` が `checkPreFlight()` / `getMaxTokens()` を通さない理由をコメントで明記
- [x] `BuiltInAiProvider` の単体テストを新規作成（12件、現状0だった）
- [x] Gemini のリトライ抑止を検証する単体テストを追加（`providerParity.test.ts`）
- [x] 使用量記録の条件を検証する単体テストを追加
- [x] `npm run validate` が成功する（7496 tests pass）

### 実装結果（2026-08-08）

#### 1. リトライ述語の共通化

`ProviderStrategy.shouldRetrySummaryRequest()` として基底クラスへ。OpenAI が持っていた述語をそのまま採用（429 抑止・非冪等5xx 抑止）。**Gemini の挙動が変わる**: 429 でリトライしなくなった。

#### 2. 使用量記録の共通化

`ProviderStrategy.recordUsageIfPresent()`。トークン数が両方 `undefined` なら記録しない（OpenAI 側の挙動を正とする）。**Gemini の挙動が変わる**: `usageMetadata` 欠落時に `recordUsage(0, 0)` を記録しなくなった。

#### 3. BuiltInAiProvider

- `sanitizeContent()` を通すようにした。オンデバイス実行でも、注入された指示が要約を汚染して Obsidian に書き込まれるリスクは残るため
- `checkPreFlight()` は**意図的に通さない**。月次上限・使用量警告・レート制限はいずれも有料APIのコスト保護が目的で、オンデバイスには該当しない（コード内コメントに明記）
- `getMaxTokens()` も**通さない**。`BuiltInAIClient.summarize()` がトークン上限引数を取らないため
- 使用量記録を追加（従来は一切記録していなかった）

### テストが本当に欠陥を捕まえることの確認

`GeminiProvider` から `shouldRetry` を再び外したところ、`providerParity.test.ts` の Gemini 系4件が失敗することを確認した（復旧済み）。

### 補足: フルテスト実行時の失敗について

作業中、フルスイート実行で `recordingLogic-impl.test.ts` と `RecordingPipeline.test.ts` が失敗する事象があったが、**本変更とは無関係**だった。

- 個別実行では両ファイルとも成功（46件）
- `src/background/` 全体（114ファイル）でも成功
- 失敗時の実行は `setup` だけで 1037秒（通常 30秒）かかっており、マシン負荷によるワーカータイムアウト
- `failureMessages` が空（アサーション失敗ではない）

クリーンな状態で再実行し、407ファイル7496件すべて成功することを確認済み。

## テスト戦略

### 単体テスト
- `GeminiProvider`: 429 でリトライしないこと（**挙動変更の回帰テスト**）
- `GeminiProvider`: `usageMetadata` 欠落時に `recordUsage` を呼ばないこと（**挙動変更**）
- `BuiltInAiProvider`: 新規。プロンプトインジェクションのブロック、正常系の要約、エラー処理
- `ProviderStrategy`: 共通化したリトライ述語・使用量記録の単体テスト（既存417行を拡張）

### 回帰テスト
- 既存 `GeminiProvider.test.ts`（554行）/ `OpenAIProvider.test.ts`（405行）
- `aiClient-priority-fallback.test.ts`（418行）

## 実装アプローチ

1. 使用量記録の共通化（最小・独立・影響が読みやすい）
2. リトライ述語の共通化 + Gemini の挙動変更テスト
3. `BuiltInAiProvider` のテストを**先に**書く（現状の振る舞いを固定）
4. `BuiltInAiProvider` を `sanitizeContent()` に載せる
5. 各ステップで `npm run validate`

## 見積もり
2pt（共通化2件 + BuiltInAiProvider のテスト新規作成と安全機構への接続）

## 技術的考慮事項

- **副作用🔴あり**: Gemini のリトライ挙動が変わる。429 でリトライしなくなるため、一時的なレート制限で要約が失敗するケースが増える可能性がある。ただし「429 でリトライしない」は OpenAI 側で既に採用済みの正しい方針（リトライは制限を悪化させる）
- `BuiltInAiProvider` に `sanitizeContent()` を通すと、従来成功していた要約がブロックされる可能性がある。高危険度のみブロックする既存ロジックのため影響は限定的だが、実機確認が望ましい
- `recordUsage` の変更は使用量統計の連続性に影響する（Gemini の 0,0 レコードが消える）。統計画面の表示に依存があるか確認

## 関連

- アーキテクチャレビュー（2026-08-08）小粒指摘
- 先行作業: `dev-docs/archived/pbi/2026-08-07-01-refactor-ai-provider-common-extraction.md`（基底クラスへの抽出。本PBIはその残り）
- ADR: `dev-docs/ADR/2026-04-21-ai-provider-abstraction.md`
- 対象: `src/background/ai/providers/{ProviderStrategy,OpenAIProvider,GeminiProvider,BuiltInAiProvider}.ts`
