# RecordingResult.maskedItems 型硬化

## Context

RecordingResult インターフェースの `maskedItems` フィールドに `any[]` 型が残存しています。

**現状:**
```typescript
export interface RecordingResult {
  // ...
  maskedItems?: any[];
}
```

**レビュー指摘:**
- **指摘者**: Maintainability Guardian
- **場所**: `src/background/recordingLogic.ts:135`
- **優先度**: Low
- **影響**: `any[]` 型による型安全性の低下。コンパイル時エラーが検出されない。

## Decision

### 実装方針

`any[]` 型を具体的な型定義に置換し、型安全性を向上させる。

### 実装内容

maskedItems はPIIマスキングされた項目のリストで、以下の形式を想定:
- 単一文字列: マスクされた項目の種類（例: "card-number"）
- オブジェクト: 詳細情報（例: `{ type: "card-number", original: "1234", index: 0 }`）

## Implementation

### 型定義変更：messaging/types.ts に統合

```typescript
// src/messaging/types.ts

/**
 * PIIマスキングされた項目の型
 */
export interface MaskedItem {
  type: string;       // マスク項目の種類（例: "card-number"）
  original?: string;  // 元の値（デバッグ用、本番環境では使用しない）
  index?: number;     // 位置情報（例: 0, 1, 2...）
}

/**
 * 記録処理の結果型
 */
export interface RecordingResult {
  // ...
  maskedItems?: (string | MaskedItem)[]; // マスクされたPII項目のリスト
}
```

### 変更内容

1. **messaging/types.ts**: MaskedItem、RecordingResult 定義を追加
2. **recordingLogic.ts**:
   - messaging/types.ts から RecordingResult, MaskedItem をインポート
   - 重複した型定義を削除
3. **privacyPipeline.ts**: any[] 型を (string | MaskedItem)[] に置換
4. **logger.ts**: any 型を適切な型に置換
5. **popup/main.ts**: any[] 型を (string | MaskedItem)[] に置換

## Status

- **Proposed**: 2026-03-25
- **Approved**: 2026-03-25
- **Implemented**: 完了
- **Verified**: TypeScript type-check パス
- **Superseded By** -