# Plan A: AI要約クレンジング フォールバック改善

## 問題

AI要約クレンジングが記事本文まで削除してしまう過剰削減が起きている。

**CNNの実例:**
- Content Cleansing後: 5072B
- AI要約クレンジング後: 547B（89.2%削減、93要素削除）
- AIに送られた内容: `2:05 • Source: CNN` のみ

**フォールバックが発動しなかった理由:**
現在の条件は `(cleansed / original < 0.10) AND (cleansed < 2000B)` の両方を満たす必要がある。

```
547 / 5072 = 0.108 = 10.8% → 10%を0.8%上回り、フォールバック発動せず
```

## 目標

「削りすぎ」を検出し、クレンジング前の適切なコンテンツ（コンテンツ抽出直後のテキスト）に立ち戻ってAIに送る。

## 実装方針

### Step 1: フォールバック判定条件の見直し

**ファイル:** `src/utils/contentExtractor/index.ts`（L323-327, L451-455）

現在の条件:
```typescript
const _overCleansed = aiSummaryOriginalBytes !== undefined
    && aiSummaryOriginalBytes > 0
    && (_contentBytes / aiSummaryOriginalBytes) < 0.10   // ← 10%
    && _contentBytes < 2000;                             // ← 2000B
```

変更案（OR条件に緩和 + 閾値引き上げ）:
```typescript
const _overCleansed = aiSummaryOriginalBytes !== undefined
    && aiSummaryOriginalBytes > 0
    && (
        (_contentBytes / aiSummaryOriginalBytes) < 0.20  // 20%未満（10% → 20%）
        || _contentBytes < 500                           // 500B未満なら無条件（新規追加）
    );
```

**変更理由:**
- 10% → 20%: CNNのような89%削減ケースをカバー
- 500B未満: どれだけ割合が高くても絶対量が少なすぎる場合はフォールバック

### Step 2: フォールバック先の改善

**現在の動作:** フォールバック時は `document.body.innerText` 全体（膨大）を使用

**問題点:** body全体を使うと逆に不要な情報が大量に含まれる

**改善案:** フォールバック先を段階的に選択する

```
優先順位:
1. aiSummaryクレンジング前のテキスト（Content Cleansing後）
   → これが「本文らしい内容を含む最小限のテキスト」として最適
2. candidates[0]の生テキスト（Content Cleansingもなし）
3. document.body.innerText（現在の動作、最終手段）
```

実装のために、クレンジング前のテキストを変数に保持しておく:

```typescript
// AI要約クレンジング前にテキストを保存
let preAiCleanseText: string | undefined;
if (aiSummaryCleanseEnabled) {
    preAiCleanseText = extractTextFromElement(clone); // クレンジング前
}

// ... cleanseAISummaryContent() 実行 ...

// フォールバック判定
if (_overCleansed && preAiCleanseText) {
    fallbackTriggered = true;
    content = preAiCleanseText;  // body全体ではなく、クレンジング前テキストを使用
    // ...
}
```

### Step 3: フォールバック情報の記録

フォールバックが発動したことをUI（ポップアップの統計表示）で伝えるために、`fallbackTriggered` フラグと理由を `ExtractResult` に含める（すでにフィールドは存在する）。

フォールバックの理由タイプを追加:

```typescript
// types.ts に追加
type FallbackReason = 'none' | 'short_content' | 'over_cleansed';
```

## 対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/utils/contentExtractor/index.ts` | フォールバック判定条件の緩和、フォールバック先の改善（2箇所） |
| `src/utils/contentExtractor/types.ts` | `FallbackReason` 型追加（任意） |
| `src/utils/contentExtractor/__tests__/index.test.ts` | フォールバック条件のテスト追加 |

## テストケース

| シナリオ | クレンジング前 | クレンジング後 | 期待動作 |
|---------|-------------|-------------|---------|
| 正常ケース | 5000B | 2500B (50%) | フォールバックなし |
| 軽度削減 | 5000B | 800B (16%) | フォールバックなし（現行境界ケース） |
| CNNケース | 5072B | 547B (10.8%) | **フォールバック発動**（今回修正） |
| 極端削減 | 5000B | 400B (8%) | フォールバック発動 |
| 絶対量不足 | 600B | 300B (50%) | **フォールバック発動**（500B未満条件） |

## 実装順序

1. `index.ts` のフォールバック条件を修正（2箇所、L326-327 と L453-454）
2. フォールバック先を `preAiCleanseText` に変更
3. テストを追加・更新
4. `npm validate` で確認
5. 実際のニュースサイト（CNN等）で手動検証

## 注意点

- フォールバック時も `maxChars` 制限は適用される（変更不要）
- `fallbackTriggered = true` のとき、UI側の統計表示でフォールバック発動を示す表示が出る（既存の仕組み）
- 変更は `candidates` がある場合とない場合の**2箇所**に同じ修正が必要
