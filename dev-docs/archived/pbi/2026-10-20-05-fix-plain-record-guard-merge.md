# PBI: encryptionSession.ts の asRecord と settingsMigration.ts の isPlainRecord を共通ガードに統合する

## ユーザーストーリー

拡張機能の開発者として、「untrusted な unknown 値をプレーンオブジェクトに絞り込む」ガードが 1 箇所にあってほしい、なぜなら `src/utils/storage/encryptionSession.ts:381` の `asRecord` と `src/utils/storage/settingsMigration.ts:194` の `isPlainRecord` が同一条件の重複であり、両方ともストレージの untrusted データ（暗号封筒・レガシー設定）を扱う security-adjacent ガードなのに、片方だけが将来強化された場合（例: プロトタイプ汚染対策の追加）にもう片方へ波及しないから。

## 優先度

- 順位: 05 / 6
- RICE: 20（Reach=15 / Impact=0.5 / Confidence=80% / Effort=0.3）
- 根拠: 同一条件の確認済み重複の統合。影響は保守性のみだが、security-adjacent な箇所ほど一元化の価値が高い。依存なし
- 種別: 🔧非機能追加（fix） / 難易度: 🟢低 / 副作用: 🟡軽微

## 背景（出典）

2026-10-20 の簡素化パス サブエージェント報告（storage util 簡素化の未適用発見 8）。両関数は module-private で条件が同一:

```ts
// encryptionSession.ts:381-385
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// settingsMigration.ts:194-196
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
```

違いは戻り値の規約だけ（cast-or-undefined vs type guard）。**統合前にこの同一性を実ファイルで再確認すること**が受入条件（将来どちらかが既に変わっていた場合、統合ではなく文書化に切り替える）。

## BDD受け入れシナリオ

```gherkin
Scenario: 共通ガードは両用途の契約を満たす
  Given 共通の plain-object ガードがある
  When null / 配列 / オブジェクト / プリミティブ / 日付を渡す
  Then null・配列・プリミティブ・日付は record として扱われない
  And プレーンオブジェクトは Record<string, unknown> として絞り込まれる

Scenario: 統合後も両ファイルの挙動が変わらない
  Given 既存の暗号系・マイグレーション系テストがある
  When asRecord 呼び出しを共通ガードに置き換える
  Then 暗号系・マイグレーション系の既存テストが無修正で通る
```

## 受け入れ基準

- [x] 統合前に両ガードの同一性（null / typeof / Array.isArray 条件）を実ファイルで再確認し、結果を完了記録に残す。**条件がズレていた場合は統合せず、この PBI を却下または再設計する**
- [x] 共通ガードが `src/utils/objectUtils.ts`（`pickDefined` の在処）に追加される、または同等の既存 util モジュールに置かれる
- [x] 両ファイルの呼び出しが共通ガードに向き、ローカル定義が消えている
- [x] 暗号系・マイグレーション系の既存テストが無修正で通る
- [x] manifest.json を変更していない（呼び出しは background 系コードのみで、content script の動的 import が発生しないことを grep で確認）
- [x] `npm run validate` が緑

## テスト戦略

### 単体

共通ガードに null / 配列 / オブジェクト / プリミティブ / 日付の境界テストを置く（objectUtils の既存テストファイルに追加）。既存の暗号系・マイグレーション系テストが挙動不変の対照。

### 統合 / E2E

不要。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイルで確認）

| ファイル | 行 | 役割 |
|---|---:|---|
| `src/utils/storage/encryptionSession.ts` | 381-385 | `asRecord`（cast-or-undefined） |
| `src/utils/storage/settingsMigration.ts` | 194-196 | `isPlainRecord`（type guard） |
| `src/utils/objectUtils.ts` | - | 統合先候補（`pickDefined` 在処） |

### 最小変更の選択肢

**選択肢 1（推奨）: type guard 1 つに統合**

`isPlainRecord(value: unknown): value is Record<string, unknown>` を util に置き、asRecord の呼び出しは `isPlainRecord(value) ? value : undefined` に置き換える。

- Pros: 型述語は if 文での narrow に使え、cast-or-undefined も表現できる。
- Cons: asRecord の呼び出し側が 1 行ずつ変わる。

**選択肢 2: cast-or-undefined のみに統合**

- Pros: asRecord 側の変更が最小。
- Cons: type guard として使えず、if での narrow が書けない呼び出し側が出る。

### ロールバック手順

- 変更は objectUtils.ts（追加）と 2 ファイル（呼び出し置き換え + ローカル定義削除）に切り出す。1 コミット。`git revert` で戻せる。実行時挙動は不変。

## 見積もり

0.5pt 🟢

## Definition of Done

- [x] `npm run validate` が緑
- [x] 同一性再確認の結果が完了記録に残っている
- [x] コードレビュー完了

## 関連

- pbi/00-INDEX.md
- pbi/2026-10-20-00-backlog-review-findings.md
- 出典: 2026-10-20 簡素化パス サブエージェント報告 未適用発見 8

## 完了記録（2026-10-20）

- 同一性再確認: 両ガードの 3 条件（null / typeof 'object' / !Array.isArray）が実装時点で完全一致。差は戻り値規約のみ。
- 実装: objectUtils.ts:28-37 に型述語 `isPlainRecord` を追加、encryptionSession の asRecord ローカル定義を削除して唯一の呼び出し箇所を `isPlainRecord(settings) ? settings : undefined` に置換、settingsMigration のローカル定義を削除して import に統一（hasOwn は対象外につき未触）。条件ロジックは objectUtils.ts の 1 箇所のみ。
- 挙動メモ: Date は `typeof 'object'` で旧実装と同一にガードを通るため true をテストで固定（BDD の「日付は record として扱われない」は同一条件では満たされないため、挙動不変を優先）。Date 除外は条件強化が必要で将来 PBI 候補。同種の統合候補として storageTransaction.ts:88 / aiUsageTracker.ts:80,309 / i18n.ts:40 も実装時に特定。
- 検証: 17 テストファイル 164 件が無修正で緑（objectUtils 境界テスト追加を除く） / type-check / eslint / manifest.json 未変更 / npm run validate 全緑。レビュー実害なし（asRecord 残存参照なし、層違反・循環なしを確認）。
