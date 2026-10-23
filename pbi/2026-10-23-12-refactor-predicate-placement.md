# PBI: 保存形ガード述語の配置判断

## ユーザーストーリー

保守担当者として、`savedCollections.ts` の局所ガード述語の配置を決めたい。なぜなら `validators.ts` に同義の述語があり、重複のままでは両者の差分が将来の判定割れになるから。

## 優先度

- 順位: 12 / 全12件
- RICE スコア: 2.7（Reach = 4 / Impact = 1 / Confidence = 0.5 / Effort = 0.75人日）
- 根拠: 層の配置判断が未確定のため Confidence 0.5。NN11 と同点だが、NN11 の方が変更範囲が確定しているため後に置く。

## BDD 受け入れシナリオ

```gherkin
Scenario: ガード判定が変更前と同一
  Given 正常・異常の保存形がある
  When 正規化を実行する
  Then 変更前と同一の採否になる

Scenario: 境界
  Given 空文字・0・NaN・負数がある
  When ガードする
  Then 変更前と同一に拒否される
```

## 受け入れ基準

- [ ] `asString`・`asNumber` が共有述語に寄る（または局所維持の判断を記録して閉じる）
- [ ] 層の循環が発生しない（`storage → messaging` の import は作らない）
- [ ] 既存テスト全緑

## テスト戦略（t_wada スタイル）

- E2E: なし
- 統合: なし
- 単体: 既存 `savedCollections.test.ts:17-59` の異常系 table を維持し、共有述語の table を追加（共有化した場合）

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 配置先の候補: (a) Layer 0 の新設モジュールに両者が寄る (b) 局所維持。`src/utils/storage/` から `src/messaging/validators.ts` の import は層の逆流のため禁止
- 非機能要件: 判定意味不変（`trim 空拒否`・`finite かつ > 0` を保つ）

## 変更点の概要

`asString`・`asNumber` と `isNonEmptyString`・`isFiniteNumber`・`isPositiveInteger` の重複を解消する。層の循環を避けるため、寄せる場合は Layer 0 の共有置き場を用意する。寄せない判断も許す。

## 現状と問題（file:line 付き）

- `src/utils/storage/savedCollections.ts:21-27` ― 局所 `asString`・`asNumber`（同ファイル内各2使用のみ、外部0）
- `src/messaging/validators.ts:244-258` ― `isNonEmptyString`・`isFiniteNumber`・`isPositiveInteger`
- テスト: `src/utils/storage/__tests__/savedCollections.test.ts:17-59` が異常系 table で間接的に検証する
- LAYERS.md の分類上、`storage/` から `messaging/` への import は層の逆流になるため単純な寄せは不可（主スレッドの判断）

## 変更の理由（DRY）

同じ理由（ガード意味の変更）で同時に変わるべき関係。ただし層の制約があるため、配置判断を含めて PBI 化する。

## 提案コード（骨子のみ）

```typescript
// 案 (a): src/utils/guards.ts (Layer 0。新設。名前は仮)
export function isNonEmptyTrimmedString(v: unknown): v is string;
export function isPositiveFiniteNumber(v: unknown): v is number;
// savedCollections.ts + validators.ts: 自前述語 → 共有に置換（意味同一のものだけ）
```

## 実装者向け注記

```bash
grep -rn "asString\|asNumber\|isNonEmptyString\|isFiniteNumber\|isPositiveInteger" src/utils/storage/savedCollections.ts src/messaging/validators.ts | grep -v __tests__
```

- `isPositiveInteger` と `asNumber`（`> 0` の finite）は意味が同一か先に確認する（整数性の差異があれば寄せない）
- 循環 import が生じたら (b) 局所維持を選び、その判断を記録して閉じる

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み
