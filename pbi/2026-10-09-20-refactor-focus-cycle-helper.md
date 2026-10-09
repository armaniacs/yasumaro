# フォーカス管理 Tab 循環・Escape の二重実装ヘルパー抽出（refactor）

## 1. タイトル + 種別

- **タイトル**: `utils/ui` 内で二重実装されている Tab 循環・Escape 処理を、「フォーカス可能リストを引数に取る」単一ヘルパーに抽出する
- **種別**: refactor（disabled 扱いの差は各呼び出し元が現行セレクタを渡す形で挙動維持）
- **見積もり**: 1.5 SP

## 2. 優先度

- **優先度**: 順位 20
- **RICE**: R2 / I1 / C0.8 / E1.5 → **1.1**
- **根拠**:
  - `focusTrap.ts:16-18` は「popup/dashboard 側と共有する単一の非表示判定基準」と宣言するが、`confirmDialog.ts` は独自セレクタと Tab 循環・Escape を持ち、disabled の扱いが割れている（「どの要素にフォーカスが当たるか」が部品ごとに別基準）
  - Confidence 0.8 — disabled 扱いの差が意図差かどうかの判断が残るため、現行挙動を維持する形（各呼び出し元がリストを渡す）を既定とする
- **依存**: **なし**

## 3. ユーザーストーリー

**UI 部品の保守担当者として**、Tab 循環と Escape 処理が単一ヘルパーに集約されていてほしい。なぜなら、focusTrap と confirmDialog で判定木が別々に維持されると、a11y 修正が片方だけに適用されてフォーカス挙動が部品ごとに食い違うから。

## 4. 背景

`src/utils/ui/focusTrap.ts:16-18` は「popup/dashboard 側と共有する単一の非表示判定基準」と宣言するが、同階層の `confirmDialog.ts` は独自のセレクタと Tab 循環・Escape 処理を持つ。両セレクタは disabled 要素の扱いが異なる（focusTrap は `button` のまま disabled を含み、confirmDialog は `:not([disabled])` で除外）。「どの要素にフォーカスが当たるか」が UI 部品ごとに別基準になる drift が実在している。

該当箇所（全 file:line 検証済み）:

- `src/utils/ui/focusTrap.ts:12` — `FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'`（disabled 含む）
- `src/utils/ui/confirmDialog.ts:30-37` — 別の `FOCUSABLE_SELECTOR`（`button:not([disabled])` 等、disabled 除外）
- Tab 循環の重複: `src/utils/ui/confirmDialog.ts:39-55`（`trapFocus`）vs `src/utils/ui/focusTrap.ts:102-120`（`keydownHandler` 内の同一判定木）
- Escape 処理の重複: `src/utils/ui/confirmDialog.ts:116-123` vs `src/utils/ui/focusTrap.ts:103-106`
- 利用実態: `focusTrapManager` は dashboard/popup の 10+ 箇所で使用（例: `src/dashboard/exportImport.ts:100,186`、`src/popup/privatePageDialog.ts:63,85`、`src/utils/ui/onboardingWizard.ts:156-166`）が、confirmDialog はどちらも使わない

改善案: Tab 循環＋Escape を「フォーカス可能リストを引数に取る」1 つのヘルパーに抽出し、confirmDialog から呼ぶ。セレクタの disabled 扱い差は意図差の可能性があるため、挙動維持の前提では各呼び出し元が現行のセレクタ（またはフォーカス可能リスト）を渡す形にする。`focusTrapManager` の tripwire（`FOCUS_TRAP_MAX_LIVE`、`focusTrap.ts:50`）と release 契約はそのまま。

## 5. BDD シナリオ

### シナリオ 1: Tab 循環が単一ヘルパーになる

```gherkin
Given Tab 循環・Escape の単一ヘルパーが存在する
When confirmDialog と focusTrap がキー操作を処理する
Then 両者が同一ヘルパーを呼び、フォーカス可能リストを引数として渡していること
```

### シナリオ 2: disabled 扱いの差が現行どおり維持される

```gherkin
Given focusTrap は disabled を含むセレクタ、confirmDialog は disabled を除外するセレクタを使う
When それぞれのコンテナで Tab 循環する
Then focusTrap 経由では現行どおりの要素がフォーカス対象のままであり、confirmDialog 経由では disabled が除外される現行挙動が維持されること
```

### シナリオ 3: tripwire と release 契約が不変である

```gherkin
Given focusTrapManager の FOCUS_TRAP_MAX_LIVE と release 契約がある
When 複数のトラップを開閉する
Then 上限 tripwire と release 挙動が現行どおりであること
```

## 6. 受け入れ基準

- [ ] Tab 循環＋Escape が「フォーカス可能リストを引数に取る」単一ヘルパーに抽出され、confirmDialog と focusTrap の双方がそれを呼んでいる
- [ ] confirmDialog の disabled 除外セレクタと focusTrap の disabled 包含セレクタの差が現行どおり維持されている（各呼び出し元が現行リストを渡す）
- [ ] `focusTrapManager` の `FOCUS_TRAP_MAX_LIVE` tripwire と release 契約が無変更である
- [ ] Tab 循環・Escape の外部挙動が現行と同一である
- [ ] 既存の a11y / focus 関連テストが無変更で green である

## 7. テスト戦略

1. **Tab 循環・Escape の挙動 pin 先行**: 統合前に confirmDialog と focusTrap の Tab 循環・Escape 挙動を pin するテストを確認（無ければ追加）し、統合後も同一であることを担保する
2. **disabled 差の pin**: disabled 要素を含むコンテナで両部品のフォーカス先が現行どおりであることを確認する
3. **既存テストの green 維持**: a11y / focus 関連テストを無変更で通過させる
4. **validate green**: `npm run validate`（type-check + test）で全体通過を確認する

## 8. 見積もり

**1.5 SP** — ヘルパー抽出 + 2 呼び出し元の追従 + disabled 差の挙動 pin。Confidence 0.8 のため disabled 扱いの判断確認を含む。

## 9. DoD

- [ ] 受け入れ基準 5 件すべて充足
- [ ] Tab 循環・Escape の挙動 pin が green（統合前後で同一）
- [ ] disabled 扱いの差が現行どおり維持されている
- [ ] `npm run validate`（type-check + test）が green
- [ ] 外部挙動不変

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 20（R2 / I1 / C0.8 / E1.5 → 1.1）
- 依存: なし
