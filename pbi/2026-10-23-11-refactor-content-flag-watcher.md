# PBI: content 側 storage フラグ監視の共通化検討

## ユーザーストーリー

保守担当者として、content 側の storage フラグ購読定型を共有化したい。なぜなら一時停止期限と offscreen 委譲フラグに同形（初回読込 + onChanged 無効化）が並存し、3つ目のフラグで3写し目が生まれるから。

## 優先度

- 順位: 11 / 全12件
- RICE スコア: 2.7（Reach = 4 / Impact = 1 / Confidence = 0.5 / Effort = 0.75人日）
- 根拠: 主スレッドの軽検証のみであり、共有の粒度（汎用 watcher か2件の寄せか）は実装者の判断に委ねる。Confidence 0.5。

## BDD 受け入れシナリオ

```gherkin
Scenario: フラグ判定が変更前と同一
  Given 一時停止期限・委譲フラグの各状態がある
  When 共有監視経由で判定する
  Then 変更前と同一の paused・enabled が返る

Scenario: 無効化の即時反映
  Given フラグが書換えられる
  When onChanged が発火する
  Then キャッシュが無効化され次回読込で新値が返る
```

## 受け入れ基準

- [x] 寄せない判断で閉じる（偶然の重複。3つ目の購読者が現れたら再検討）
- [x] 既存テスト（contentKernel 系・cleansingOffscreen 系）全緑

## テスト戦略（t_wada スタイル）

- E2E: なし
- 統合: なし（content 側の単体 + 既存結合で覆う）
- 単体: 共有 watcher のテスト新規（初回・無効化・chrome 不在の3経路）

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 配置先: `src/content/` の共有モジュール（content 側の seam。background・dashboard からは参照しない）
- 非機能要件: 挙動不変（無効化タイミング・既定値を保つ）

## 変更点の概要

storage フラグの「初回読込 + onChanged 無効化」定型を content 側の共有 helper に切り出す。寄せない方が読みやすいと判断したら記録して閉じる。

## 現状と問題（file:line 付き）

- `src/content/contentKernel.ts:222-247` ― `loadPausedCache` + `subscribePauseChanges`（クラス内に閉じる。主スレッドが実読で確認）
- `src/content/cleansingOffscreenDelegate.ts:35-57` ― `isCleansingOffscreenEnabled` + module-level `cachedFlag`/`storageListenerWired` + `__reset...ForTesting`（PBI 2026-09-11-05 の意図的設計。主スレッドが実読で確認）
- 同形要素: 初回読込・onChanged 無効化・chrome 不在の縮退。相違要素: クラスの有無・テスト seam の形
- テスト: 両者ともあり（`contentKernel.test.ts` 系・`cleansingOffscreen.test.ts` 他）

## 変更の理由（DRY）

同じ理由（フラグ購読の仕様変更）で同時に変わる可能性がある。ただし2件のみ・相違もあるため、寄せない判断も許す（YAGNI フィルタ：偶然の重複ならまとめない。実装者が判断して記録する）。

## 提案コード（骨子のみ）

```typescript
// src/content/storageFlagWatcher.ts (新設。名前は仮)
export function createStorageFlagWatcher(
  read: () => Promise<boolean>,
  key: string,
): { current: () => Promise<boolean>; __resetForTesting: () => void };
// 両箇所: 自前の購読 → watcher 委譲に縮小（または現状維持の判断記録）
```

## 実装者向け注記

```bash
grep -rn "onChanged.addListener" src/content/ --include='*.ts' | grep -v __tests__
```

- PBI 2026-09-11-05 の意図（毎回 storage 打撃の回避）を壊さない
- content script の module-level 状態は MV3 の ephemeral 規則の対象外（SW ではない）であることを前提に判断する

## Definition of Done

- [x] 共有化しないため新規テストなし。既存テスト緑（contentKernel 系 23 件）で代替
- [x] 既存テスト全通過（共有化しないため watcher テストは作らない）
- [ ] `npm run validate` 通過（Phase 3 のフルゲートで確認する）
- [x] ドキュメント更新済み
