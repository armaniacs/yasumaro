# PBI 2026-09-12-29 — 小型バグバンドル（4 件）

- **種別**: 🔧非機能追加（fix）
- **優先度**: 5 位 / RICE **12.0**（R15 × I1 × C80% / E1.0人日）
- **出典**: round 12 診断 候補 29（サブエージェント探索・file:line は各項に記載）

## 背景（なぜ）

探索で見つかった小型の欠陥群。単独 PBI 化するほどではないが、放置すると顕在化時に追跡コストが高い。

## スコープ（4 件）

- [ ] **statusToggleBtn の二重配線**: `statusPanel.ts:72-88` — initStatusPanel が whitelist write 後に再帰する（:390,:415 `await initStatusPanel()`）ため toggle handler が蓄積。`wireOnce`（domUtils・PBI 20 で新設）を適用
- [ ] **removeAll が N 回の即時 flush**: `tabCache.ts:154-156` — bulk 窓閉じで tab 数分の session 書込が発生（PBI 24 で remove を flushImmediately 化した副作用）。batch + 単一 flush に修正
- [ ] **contentKernel の gate! 非null assert**: `contentKernel.ts:347` — pre-init `checkVisitConditions()` で crash（thresholds は round 6 に fallback 済み・gate は未対応）。null ガードを追加
- [ ] **tagClusterLoading の stale labels**: `tagClusterLoading.ts:21-26` — label を field init で解決し locale 切替に追随しない。`show()` 毎に再解決（previewView.refreshLabels と同型）

## 受け入れ基準（BDD）

### シナリオ 1: 各 fix が欠陥を解消する（ハッピーパス）
```gherkin
Given 上記 4 項目の欠陥がある
When 各 fix を適用する
then toggle は一度だけ配線され、bulk 削除は 1 flush になり、pre-init 呼び出しは crash せず、locale 切替後に新言語が表示される
```

### シナリオ 2: 最小 fix の原則（境界）
```gherkin
Given removeAll の batch 化
When 呼び出し側を検査する
then 振る舞い（削除 + 永続化）は不変で flush 回数のみ変わる
```

## DoD

- [x] 4 件実装 + 各 pin/回帰テスト
- [x] 関連テスト green
- [x] type-check / lint green

## 見積もり

🟡中（2pt目安） / 副作用: 🟢なし

## 実装メモ（2026-09-12）

- **statusToggleBtn 二重配線**: `wireOnce(toggleBtn, ...)` 適用（PBI 20 で新設した共有 seam）
- **removeAll N flush**: batch delete + 単一 flushImmediately（remove 個別呼び出しの N 回書込を統合）
- **gate! pre-init crash**: `checkVisitConditions` が `deadlineTimer.gate` null 時に `createVisitGate()` へフォールバック（thresholds と同一のフォールバック紀律）。`gate!.isReportable` の非null assert を削除
- **tagClusterLoading stale labels**: steps を field init から `buildSteps()`（show 毎に i18n 再解決）へ変更。LOADING_STEP_KEYS を定数化
- 検証: popup/content/dashboard/background 3,569 tests green・全テスト FAIL 0・type-check green・lint 0 errors
