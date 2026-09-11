# PBI 07: content throttle を honest な leading+trailing 実装に置換し dispose を提供

## ユーザーストーリー

スクロールで訪問を記録する利用者として、連続スクロール中でも最大スクロール深度が正しく追跡され、content script の listener が無限に増えないことを知りたい。なぜなら現状の throttle は last-call-wins debounce で trailing 分岐が死んでおり、100ms の静寂が出るまで `updateMaxScroll` が発火しないから。

## 優先度

- 順位: 07 / 9
- RICE スコア: 5.3（Reach=2 / Impact=1 / Confidence=90% / Effort=0.25 人週）
- 根拠（round 6 直接検証）: `src/content/throttle.ts:11-39` — ①`else if`（:24）が同一フレーム内で同条件を再テストする dead branch で、trailing 呼び出しが実質無い。②throttle 呼び出し毎に `window.beforeunload` listener が積まれ、dispose 返却なし（:32-39）。③`THROTTLE_DELAY` が closure 内マジックリテラル。唯一の caller は `contentKernel.ts:400`（scroll → updateMaxScroll → visit gate 判定に波及）。

## BDD 受け入れシナリオ

```gherkin
Scenario: 連続スクロールでも trailing 呼び出しが保証される
  Given 100ms 間隔を空けずに scroll が 10 回発火する
  When throttle 経由で updateMaxScroll が呼ばれる
  Then 最後の呼び出しから 100ms 以内に 1 回 trailing 発火する

Scenario: dispose で listener が除去される
  Given throttle が dispose 済み
  When beforeunload が発火する
  Then throttle の flush listener は呼ばれない
```

## 受け入れ基準

- [x] leading + 保証付き trailing（timestamp + timer）の実装に置換
- [x] `{ fn, dispose }`（または等価）を返却し beforeunload は module-level 単一 owner（全 live instance を flush）
- [x] `THROTTLE_DELAY` を注入可能に（default 100）
- [x] contentKernel の呼び出し側を新契約に更新（mount で dispose を保持）
- [x] throttle テスト新設（trailing 保証・dispose・storm 挙動）

## テスト戦略

vitest fake timers で trailing/dispose を検証。

## 見積もり

S（0.25 人週）。種別: fix。

## 実装メモ（2026-09-11 round 6）

- throttle を rAF-debounce（trailing dead branch・scroll 中 updateMaxScroll 落下）から leading + 保証付き trailing（timestamp + timer・最新 args）に再実装。clock は performance.now（monotonic・fake timer 耐性）+ lastCall=-Infinity で初回必ず leading。
- `{ fn, dispose }` 返却 + module-level 単一 beforeunload flush owner（旧: 呼び出し毎に listener 蓄積）。THROTTLE_DELAY を delayMs option に。
- contentKernel: throttle 経由の handler を dispose 登録に更新（stopPeriodicCheck で dispose）。extractor-comprehensive の旧実装 pin 3 件を新契約に更新 + fake timer 漏れ修正。
- 新規テスト `throttle.test.ts`（leading・trailing 保証・sustained tick・dispose・単一 flush）。
