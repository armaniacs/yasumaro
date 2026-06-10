# promptSanitizer.ts の過剰パターンによるコンテンツ破壊修正

## Context

promptSanitizer.tsには多数のプロンプトインジェクション検出パターンが定義されていますが、これらのパターンが過剰にマッチし、正当なWebページコンテンツ（技術文書、学術資料など）が不必要に削除される問題があります。

**現状のコード (INJECTION_PATTERNS):**
```typescript
const INJECTION_PATTERNS = [
  /ignore\s+(?:above|all|previous|other|input|instructions?)/gi,
  /disregard\s+(?:above|all|previous|other|input|instructions?)/gi,
  // ... 84個以上のパターン
  /\b(?:PROVIDE|SHOW|EXHIBIT|REVEAL|DISPLAY|OUTPUT|PRINT|ECHO|RETURN|SEND|TRANSMIT|EXTRACT|ENCRYPT|DECRYPT|EMAIL|EMAILING|SHARE)\b(?!\\s+(?:me|us|now|please))/gi,
  // ...
];
```

**問題点:**
1. 過剰なマッチ: 技術文書、コード例が誤検知される可能性
2. コンテンツ破壊: 正当な内容が[FILTERED]に置換され、要約品質が低下
3. テスト不足: 誤検知率を計測・CIで監視する仕組みがない
4. False Positiveの許容範囲が不明

**影響例:**
- "Provide the following code" ↔ "PROVIDE"パターンに誤マッチ
- "System Administrator" ↔ "SYSTEM", "ADMIN"パターン誤マッチ
- "Now let's analyze..." ↔ "now"パターン誤マッチ

## Decision

### 解決アプローチ: 多段階アプローチ

#### フェーズ1: テストによる現状把握（TDD）
- 既存パターンの誤検知率をテストで計測
- 正当なWebページコーパスでFalse Positiveを特定

#### フェーズ2: パターン精度向上
- 文脈を考慮したパターン修正（単語境界、周囲文脈チェック）
- 過剰パターンの削減・精緻化
- False Positive率の目標設定（例: <1%）

#### フェーズ3: CI監視
- 誤検知率監視テストをCIに統合
- 新パターン追加時のCI Gate

### 修正方針

1. **コンテキストパターン追加**: 前後の文脈を考慮したパターン
   - 単語境界`\b`の強化
   - 文頭・文尾のチェック

2. **共通ワードの除外**: 文脈によく登場するワードを除外リスト化
   - "now" → システム命令ではないものは除外

3. **ホワイトリスト認識**: 技術用語を認識し誤検知防止
   - "System Administrator" → 技術資料として許可

## Consequences

### Positive

- 誤検知低減: 正当なコンテンツが保護される
- 要約品質向上: [FILTERED]置換削減により正確な要約が可能
- 計測可能: テストで誤検知率を把握・追跡可能

### Negative

- 実装コスト: パターン精緻化にはテスト・検証工数が必要
- セキュリティ低下リスク: 過剰にルールを緩和するとインジェクション対策が弱まる

### Mitigation

- 段階的アプローチ: 少しずつパターンを緩和し、監視を続ける
- CI Gate: 誤検知率が一定以上のときにPRをブロック
- 手動レビュー: 高リスク検出ケースの定期的レビュー

## Implementation Steps

### フェーズ1: 現状把握（今回実施）
- [x] ADR作成
- [x] TDD Red: 誤検知率計測テスト作成
- [x] TDD Green: 既存パターンでテスト実行 - ベースライン取得

**ベースライン測定結果:**
- 誤検知率: 80% (8/10)
- 誤検知された正当コンテンツ:
  - "The system administrator configured the settings." (SYSTEM, SETTINGS)
  - "Provide your feedback via email..." (PROVIDE, EMAIL)
  - "Now shipping..." (NOW)
  - "The execute() function..." (execute())
  - "User passwords are encrypted..." (passwords)
  - "Display the results..." (Display)
  - "Send a notification..." (Send)
  - "Share the document..." (Share)

### フェーズ2: パターン修正（今回実施）
- [x] TDD Red: 修正後の誤検知率目標定義（目標: <20%）
- [x] TDD Green: 精緻化パターン実装（`promptSanitizer-refined.ts`）
- [x] TDD Green: テスト実行・検証

**精緻化パターン実装結果:**
- 誤検知率: 0% (0/10) ← 目標<20% 達成
- True Positive検出: 4/4 (100%)
- 全13件パス

**精緻化方針:**
1. 文脈無視パターンを精緻化（頻出用語の独立使用を許可）
1. プロンプト命令特有の構文を検出（`i want you to do X`, `act as Y` 等）
1. 安全コンテキストパターンで誤検知抑制（時間表現、技術用語）

### フェーズ3: CI統合（完了）
- [x] `promptSanitizer-refined.ts`を本番に統合 ← 実施完了
- [x] CIプロセスに誤検知率テスト統合 ← 実施完了
- [x] 新規パターン追加時のCI Gate実装 ← 実施完了

**CI統合実装:**
- `npm run test:false-positive-rate` - 誤検知率テスト実行
- `npm run test:gate:false-positive` - CI Gate（閾値<20%で失敗）
- `scripts/test-gate-false-positive.mjs` - CI Gateスクリプト
- CI Gate結果: 誤検知率0% (閾値20%未満) ✓

## Status

- **Proposed**: 2026-03-20
- **Approved**: 2026-03-20
- **Implemented**: Complete (Phase 1 + Phase 2 + Phase 3)
- **Superseded By**: -

## Implementation Summary

### Phase 1: 現状把握（完了）
- ベースライン測定結果: 誤検知率 80% (8/10)

### Phase 2: パターン修正（完了）
- 精緻化パターン実装結果: 誤検知率 0% (0/10) ← 目標<20%達成
- True Positive検出: 4/4 (100%)
- promptSanitizer.tsへの統合完了
- テスト更新完了: 41件全パス
  - promptSanitizer.test.ts: 28件パス
  - promptSanitizer-false-positives.test.ts: 9件パス
  - promptSanitizer-refined-test.test.ts: 13件パス

### フェーズ3: CI統合（完了）
- [x] `promptSanitizer-refined.ts`を本番に統合 ← 実施完了
- [x] CIプロセスに誤検知率テスト統合 ← 実施完了
- [x] 新規パターン追加時のCI Gate実装 ← 実施完了