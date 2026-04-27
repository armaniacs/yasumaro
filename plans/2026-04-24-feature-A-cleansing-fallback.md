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

### Step 1: フォールバック判定条件の見直し ✅

**ファイル:** `src/utils/contentExtractor/index.ts`（L326-334, L471-479）

**変更内容:**
- 10% → 20% に緩和（`< 0.10` → `< 0.20`）
- 2000B → 500B に引き下げ（より厳密な閾値）
- AND条件 → OR条件に変更（いずれかを満たせばフォールバック）

**現在の条件:**
```typescript
const _overCleansed = aiSummaryOriginalBytes !== undefined
    && aiSummaryOriginalBytes > 0
    && (
        (_contentBytes / aiSummaryOriginalBytes) < 0.20  // 10% → 20%に緩和
        || _contentBytes < 300                            // 絶対量が300B未満ならフォールバック
    );
```

### Step 2: フォールバック先の改善 ✅

**現在の動作:** フォールバック時は `document.body.innerText` 全体（膨大）を使用

**改善内容:**
- 過剰削減の場合は `preAiCleanseText`（AI要約クレンジング前のテキスト）に戻す
- 短すぎるコンテンツの場合は `document.body.innerText` を使用（現行維持）
- `fallbackReason` フィールドに理由（`'over_cleansed'` または `'short_content'`）を記録

**実装例:**
```typescript
if (_overCleansed && preAiCleanseText) {
    fallbackTriggered = true;
    content = preAiCleanseText;  // クレンジング前テキストに戻す
    fallbackReason = 'over_cleansed';
} else {
    content = document.body?.innerText || '';
    fallbackReason = 'short_content';
}
```

### Step 3: フォールバック情報の記録 ✅

- `fallbackTriggered` フラグ: フォールバック発動を記録
- `fallbackReason` フィールド: 発動理由（`'over_cleansed'` / `'short_content'`）を記録（`types.ts` に型定義済み）
- `returnInfo` モードでのみ付与される

### Step 4: テストの更新 ✅

**更新内容:**
- フォールバック発動テストの閾値を20%に更新
- `aiSummaryCleansedElements` フィールドのテスト追加
- テストケース網羅（正常系、過剰削減系、カウント系）

**実装済みテスト:**
- `extractMainContent - edge cases > triggers fallback when over-cleansed`
- `extractMainContent - returnInfo counting` 関連テスト
