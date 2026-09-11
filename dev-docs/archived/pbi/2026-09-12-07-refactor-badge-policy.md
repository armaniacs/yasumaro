# PBI 2026-09-12-07 — BadgePolicy（バッジ interface の 4 owner 統合）

- **種別**: 🔧非機能追加（refactor + fix・SW ルール違反解消を伴う）
- **優先度**: 7 位 / RICE **8.0**（R15 × I1 × C80% / E1.5人日）
- **出典**: round 9 診断 候補 07・サブエージェント探索 + 直接検証

## 背景（なぜ）

state→表示（text / color / tabId scope）の政策が 4 箇所で再派生している:

- `systemHandlers.ts:149-150` — `C${totalRemoved}` + GREEN（per-tab）+ **`setTimeout` 3s clear（:152-156・SW ルール違反、SW 停止で clear が消滅）**
- `recordingHandlers.ts:137-142` — `◎`
- `tabEventHandlers.ts:46-110` — `!` / `∉` / `●` / `''`、global と per-tab が混在（:57,65,68,74,77,85 は global）
- `consentBadge.ts:20-39` — `!` / clear（global）

global `setBadgeText` が per-tab `◎` / `C{n}` を上書き消去する（global clear が全タブの per-tab badge を消す）。

## スコープ

- `src/background/badgePolicy.ts` 新設: state テーブル（recording / cleansed(n) / private / excluded / idle / no-consent → {text, color, scope}）+ `setBadge(state, tabId?)` seam
- 4 call site を委譲に置換。`setTimeout` clear は state 遷移で解消（SW 内 timer の廃止）
- global clear が per-tab badge を消さない契約を pin（regression テスト）
- `cleansingBadge.ts` は counts→reason 派生の adapter として維持（並行政策にしない）

## 受け入れ基準（BDD）

### シナリオ 1: global 状態遷移は per-tab badge を消さない（ハッピーパス）
```gherkin
Given tab 1 に per-tab の cleansed badge が表示されている
When tab 2 の activation で global バッジ状態が更新される
Then tab 1 の per-tab badge は保持される
```

### シナリオ 2: SW 内 setTimeout を使わない（ルール）
```gherkin
Given badge clear を遅延させる経路
When クレンジング完了後の clear が予約される
Then chrome.alarms または state 遷移で解決され setTimeout は存在しない
```

## DoD

- [x] BadgePolicy 新設・4 call site 委譲
- [x] setTimeout 廃止 + scoping 契約テスト
- [x] background badge 関連テスト green
- [x] type-check / lint green

## 見積もり

🟡中（2pt目安） / 副作用: 🟡軽微（badge 遷移タイミングの見た目がわずかに変わる可能性）

## 実装メモ（2026-09-12）

- `src/background/badgePolicy.ts` 新設: `badgeDisplay`（state → {text, color} テーブル）+ `setBadge(state, tabId?)` seam。7 state（cleansed/recorded/private/excluded/recording/no-consent/clear）
- **agent の「global clobber」主張は訂正**: Chrome の action API は per-tab 上書きが global set より優先して持続するため、global 書込が per-tab badge を消すことはない。実際の逆方向バグは **tab 派生状態の global 書込**（handleTabActivated が private/excluded/recording を tabId 無しで書く）で、これは他タブへのフォールバックとして漏出する → 全 tab 派生書込を per-tab に修正（テスト pin 9 件更新）
- setTimeout 3s clear を廃止: SW 停止で timer が死に事実上発火しないため、navigation での state 遷移（handleTabUpdated の clear）がクリアを担う。`hasBadgeTab` dep を削除（MessageRouter の wiring も更新）
- sender.tab!.id! crash も同ハンドラのため本 PBI で解消（PBI 08 の項目 3 を吸収・guard + 早期 return）
- 検証: badgePolicy 10 tests 新設・background 全 171 ファイル 2289 tests green・type-check / lint 0 errors green
