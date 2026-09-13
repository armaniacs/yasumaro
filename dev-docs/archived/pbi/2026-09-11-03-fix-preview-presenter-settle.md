# PBI 03: previewPresenter の settle 単一 seam 化 + focusTrap の単一 owner 化

## ユーザーストーリー

記録プレビューを確認する利用者として、確認モーダルがどんな状態でも promise が必ず確定し（ハングしない）、モーダルの keyboard trap が単一の owner で管理されてほしい。なぜなら現状 4 つの settle path のうち 1 つが caller promise を黙って捨て、previewView と presenter の両方が同一 modal を trap しているから。

## 優先度

- 順位: 03 / 9
- RICE スコア: 13.7（Reach=3 / Impact=2 / Confidence=80% / Effort=0.35 人週）
- 根拠（round 6 直接検証・ledger の「最も本物に近い」の実体）:
  - `previewPresenter.ts:223-227` — `handleAction` の DOM 欠損 path が resolve/reject を null 化するだけで **caller promise を永久ハング**（他 3 path は必ず settle）
  - 成功 path も `resizeObserver` を切断しない（次回 show まで 1 observer 生存）
  - `cleanupModalEvents`（:142-149）が flag だけ下ろして `removeEventListener` しない → cleanup→init 循環で listener 蓄積（現状は null-guard が守るが adapter が flag の主張と不一致）
  - `previewView.ts:49-50,120-138` — `confirmHandlers/cancelHandlers` が production caller 無しで増加（clearHandlers の caller 無し）
  - `previewPresenter.ts:250-253` と `previewView.ts:75-103` が**同一 modal を二重 trap**（facade 経由で今日は dormant だが live コード）
  - `focusTrap.ts:48-55` — handlers/previousFocus が無境界（release 漏れ = keydown listener 永久残留）、`releaseAll` の production caller 無し

## BDD 受け入れシナリオ

```gherkin
Scenario: DOM 欠損時でも promise が reject する
  Given preview モーダルが DOM から消えた状態でボタンが押される
  When handleAction が実行される
  Then caller の promise は reject され、ハングしない

Scenario: settle 後に resizeObserver が切断される
  Given preview が確認済みで settle した
  When observer 状態を確認する
  Then disconnect 済みである

Scenario: cleanup→init 循環で listener が重複しない
  Given preview の cleanup → show を 2 回繰り返す
  When modal の click listener 数を数える
  Then 1 である

Scenario: modal の focus trap は単一 owner
  Given presenter 経由で preview が開かれる
  Then view.show/close は trap を作らない
  And destroy 時に releaseAll が呼ばれる
```

## 受け入れ基準

- [x] private `settle()` seam（resolve/reject + `resizeObserver.disconnect()` + trap release）に handleAction 成功/欠損・boundHandleClose・supersede の全 path を集約
- [x] `cleanupModalEvents` に実 `removeEventListener` 追加
- [x] `confirmHandlers/cancelHandlers` を削除（deletion test 正 — clearHandlers の caller 無し）
- [x] focusTrap: presenter 単一 owner 化（view.show/close の trap 削除）+ `trap()` が disposable を返す + popup teardown で `releaseAll()` + size guard（上限超過で warn）
- [x] 関連テスト green（新規: orphan reject・listener 重複・observer 切断）

## テスト戦略

単体: 4 path の settle 網羅 + lifecycle。回帰: sanitizePreview / mask-visualization。

## 見積もり

S-M（0.35 人週）。種別: fix。

## 実装メモ（2026-09-11 round 6）

- `settle()` 単一 seam 新設（callbacks null 化 + resizeObserver.disconnect + trap release + resolve/reject）。handleAction の欠損 path は reject に（旧: null 化して return = caller 永久ハング）。成功 path は settle → modal.close（同期 close event は boundHandleClose の null-guard で吸収）。boundHandleClose も settle 経由。supersede path は teardown しない（新 show の lifecycle を壊さないため・コメント明記）。
- initializeModalEvents を flag ベースから「常時 detach→attach」の idempotent 再配線に変更（DOM 再構築に堅牢 — round 5 の pending region テストで発見した dead-button クラスも解消）。cleanupModalEvents は実 removeEventListener を実行。
- previewView から onConfirm/onCancel/getConfirmHandlers/getCancelHandlers/clearHandlers（production caller 無しの dead 配列）と show/close の trap 所有を削除 — presenter が単一 trap owner。focusTrap に FOCUS_TRAP_MAX_LIVE=10 の tripwire warn を追加。
- 新規テスト `previewPresenter-settle.test.ts`（orphan reject・single-settle・trap 無境界）+ previewView テスト更新。
