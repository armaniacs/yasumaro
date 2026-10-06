# PBI: タグ系チップ描画の複製を createTagChip 工場に集約する

## ユーザーストーリー

dashboard の保守担当者として、チップ組立を工場に寄せたい。15 行前後の塊が 5 箇所に複製され、文言・クラス・削除挙動の変更が全箇所に届かないから。

## 優先度

- 順位: 17/23
- RICE: 1.6（R4 / I1 / C0.8 / E2）
- 根拠: 2 ファイル・5 render。呼び出し側の見た目・イベント順序不変
- 依存: なし

## 背景（file:line 現状）

- `src/dashboard/tagsPanel.ts:44-55`（renderDefaultCategories）、`:61-96`（renderUserCategories）、`:142-175`（renderNormalizationEntries）
- `src/dashboard/settings/trustSettings.ts:174-204`（renderJpAnchorList）、`:234-268`（renderSensitiveList）
- 派生の同型: `trustSettings.ts:612-676`（renderPermissionSuggestList の行内ボタン）
- 共通骨格: 空 div 作製→span に textContent→×削除ボタン→aria-label→append→個別 addEventListener

## BDD受け入れシナリオ

```gherkin
Scenario: チップ組立が工場経由になる
  Given 5 render のいずれか
  When 描画する
  Then createTagChip({label, ariaLabel, onRemove, extraClass}) を経由し、見た目・イベント順序が同一である
```

## 受け入れ基準

- [x] `createTagChip` 純粋 DOM 工場が dashboard 層の共有小モジュールにある
- [x] 各 render が配列→工場→append のみに痩せている
- [x] `innerHTML=''` クリア・`hidden` 切替・`textContent` 代入は工場外に残っている
- [x] i18n 文言・`dataset` キー差異が引数化されている
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 既存 tagsPanel / trustSettings テストが green
- 実時間待ちは使わない

## 見積もり

2 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: 新規 `src/dashboard/tagChip.ts`、`tagsPanel.ts`・`trustSettings.ts`（5 render を削減。`renderPermissionSuggestList` は派生形状のため対象外）、新規 `tagChip.test.ts`（4 件）
- ゲート: 対象 3 ファイル 74 tests green / type-check PASS / lint 0 errors
