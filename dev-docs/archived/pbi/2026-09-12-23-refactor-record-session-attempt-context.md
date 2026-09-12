# PBI 2026-09-12-23 — RecordSession の prelude/tail を AttemptContext に統合

- **種別**: 🔧非機能追加（refactor）
- **優先度**: 7 位 / RICE **6.4**（R8 × I1 × C80% / E1.0人日）
- **出典**: round 11 診断 候補 23・サブエージェント探索（台帳「RecordSession branch prelude/tail」の concrete 解）

## 背景（なぜ）

normal/force の 2 分岐（recordSession.ts:362-472,475-526）が guard → arm button → spinner → run → settle → hide → report → result-state の同一契約を ~60 行ずつ手書き。drift 済み: normal は tagResultPanel reset（:382-383）+ cleansing/trust refresh（:419-423）、force は無し。失敗経路も normal は throw → showError（:446,470）、force は saveError 文字列（:517）。両者とも previewFlow が所有する SpinnerScope ではなく生 hideSpinner。

## スコープ

- `openAttempt()`（degenerate DOM で null 返却 + idle 自己復帰）と `closeAttempt(kind, ...)`（hideSpinner + result-state）を private seam に
- 分岐は差分の中間（fetch 有無・tail の分岐）のみ保持
- SpinnerScope 採用（PBI 14 で新設済み）
- 振る舞い不変（drift は現状維持 — 統合はしない）

## 受け入れ基準（BDD）

### シナリオ 1: 両分岐が同一 prelude/tail を通る（ハッピーパス）
```gherkin
Given normal / force の両操作
When 開始から終了まで実行する
Then guard・button 状態・spinner 均衡・result-state が同一契約で動く
```

### シナリオ 2: degenerate DOM で idle 復帰（境界）
```gherkin
Given statusDiv が存在しない
When start() を呼ぶ
Then openAttempt が null を返し sessionState は idle に戻る（現行どおり）
```

## DoD

- [ ] openAttempt/closeAttempt 新設・両分岐委譲・SpinnerScope 採用
- [ ] degenerate/error 経路テスト更新
- [ ] popup recordSession 関連テスト green
- [ ] type-check / lint green

## 見積もり

🟡中（2pt目安） / 副作用: 🟢なし（振る舞い不変）
