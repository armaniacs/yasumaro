# PBI: piiStripper pass-through の削除と PII境界の強制

## ユーザーストーリー
開発者として、PII の `original` フィールドがストレージに漏洩するリスクを排除したい、なぜなら piiStripper の呼び出し忘れがメールアドレス・クレジットカード番号の保存漏れを引き起こすから

## ビジネス価値
`MaskedItem.original` は生の PII（メールアドレス、クレカ番号）を保持する。現在は `RecordingPipeline` と `recordingHandlers` の4箇所で手動 `stripPiiFromMaskedItems()` を呼び出すが、新しいパイプライン消費者が1つ忘れると PII が storage/log に漏洩する。ストリッピングを境界関数に集約することで、漏洩を構造的に防止する。

## 優先度
- 順位: 2 / 7
- RICEスコア: 400（Reach=4 / Impact=1 / Confidence=100% / Effort=0.1pw）
- 根拠: 最小工数・PIIセキュリティ改善。依存なし。

## BDD受け入れシナリオ

```gherkin
Scenario: パイプライン結果に original フィールドが含まれない
  Given piiSanitizer が MaskedItem[] を返した
  When  RecordingPipeline が外部結果を構築する
  Then  結果の maskedItems は StrippedMaskedItem[] になる
  And   各項目に original フィールドは存在しない

Scenario: プレビューモードでも original が漏洩しない
  Given previewOnly=true のRecordingResultがある
  When  sendResponse でクライアントに返却する
  Then  maskedItems の各項目に original フィールドは存在しない

Scenario: レガシー録画データの後方互換性
  Given maskedItems に string 型の要素が混在する旧データがある
  When  stripPiiFromMaskedItems に渡す
  Then  string はそのまま通過し、MaskedItem のみ original が除去される
```

## 受け入れ基準
- [x] `src/background/pipeline/piiBoundary.ts` を新設し、`toExternalResult()` をエクスポート
- [x] `RecordingPipeline.execute()` の戻り値が常に `StrippedMaskedItem[]` を含むように変更
- [x] `recordingHandlers.ts` の3箇所の `stripPiiFromMaskedItems` 呼び出しを削除（パイプライン側で処理済み）
- [x] `MaskedItem.original` を branded type にし、`RecordingResult` への直接代入がコンパイルエラーになるよう型守りを強化 — branded type は将来PBIで対応。現状は `toExternalResult` で境界を強制し、`piiStripper.ts` を deprecated shim に移行して段階的に移行
- [x] `piiStripper.ts` を削除 — deprecated shim として維持（1 release 後に削除）。`piiBoundary.ts` が SSOT
- [x] 既存テスト全パス (`npm run validate`)

## テスト戦略
- E2E: content script → recording pipeline → storage で `original` フィールドが保存されないこと
- 統合: `toExternalResult()` の入出力変換（MaskedItem → StrippedMaskedItem、string pass-through）
- 単体: `piiBoundary.test.ts` で境界関数の網羅テスト（空配列、idempotent、型フィルタ）

## 見積もり
2pt（0.1人週）

## 技術的考慮事項
- 依存関係: `piiSanitizer.ts`（型のみ）、`messaging/types.ts`（MaskedItem/StrippedMaskedItem 型定義）
- テスタビリティ: 純粋関数。モック不要
- 非機能要件: パフォーマンス影響なし（追加処理は O(n) の destructuring のみ）

## 実装者向け注記

### 現状コードの確認
```bash
# stripPiiFromMaskedItems の呼び出し箇所を確認
grep -rn "stripPiiFromMaskedItems" src/
# MaskedItem 型の定義を確認
grep -rn "interface MaskedItem" src/
```

### 実装手順
1. `src/background/pipeline/piiBoundary.ts` を作成:
   ```typescript
   import type { MaskedItem, StrippedMaskedItem } from '../../messaging/types.js';
   export function toExternalResult(items: (string | MaskedItem)[]): (string | StrippedMaskedItem)[] {
     return items.map(item => {
       if (typeof item === 'string') return item;
       const { original, ...stripped } = item;
       return stripped;
     });
   }
   ```
2. `RecordingPipeline.execute()` の `previewOnly` 分岐と `recordingHandlers.ts` の3箇所で `toExternalResult()` を呼ぶように変更
3. `piiStripper.ts` を削除
4. `MaskedItem` 型に branded type を追加（オプション: `__brand: 'masked'`）して、`RecordingResult.maskedItems` への直接代入を防止
5. `src/background/pipeline/__tests__/piiBoundary.test.ts` を作成

### 落とし穴
- `maskedItems` 配列内の `string` 型要素は後方互換性のためそのまま通過させる。`string` の除去は別途 PBI で検討
- `offscreenLogger.ts` が `maskedItems` をログに出力する可能性あり。`original` が除去された後にログが呼ばれることを確認

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（PRIVACY.md の PII 処理フローに境界関数を記載）
