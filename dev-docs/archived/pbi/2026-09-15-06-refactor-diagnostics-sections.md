# PBI: diagnostics section のデータ駆動化 — section 追加を4箇所編集から1行に

## ステータス: ✅ 完了（2026-09-15）

## ユーザーストーリー

メンテナとして、診断パネルに新しい診断項目を追加するときの変更が section テーブルの1行で完結してほしい。なぜなら diagnosticsPanel は直近30コミットで6回変更のホットスポットであり、section 追加のたびに4箇所（querySections / clearSections / loadAndPopulate / render）を同期編集しているから。

## 優先度

- 順位: 1 / 本バッチ3件中
- RICEスコア: 16.0（Reach=6 / Impact=1 / Confidence=80% / Effort=0.3人週）
- 根拠: ホットスポットの変更半径を直接縮小。データ駆動化は機械的で回帰リスクが低い

## 背景（診断結果）

- `src/dashboard/panels/diagnostic/diagnosticsPanel.ts:78-111` — `querySections` と `clearSections` の二重 switch が `SectionElements`（62-76、14フィールド）の ID 羅列と対応
- `diagnosticsPanel.ts:530-587` — `loadAndPopulate` が各 section の render 呼び出しを手書き列挙
- `src/dashboard/dashboard.ts:50-68,136-156` — `attachIssueReportTrigger` のキュー + 遅延 controller 生成 + flush が時間的結合を2機構（WeakSet 冪等ガード + pending 配列）で吸収
- 対照: `debugModeStore.ts` は chrome.storage を集約する adapter として模範的（診断で健康と判定済み）

## 実装ガイド

1. **`DiagSection` テーブルを新設**（diagnosticsPanel.ts 内）:
   ```ts
   interface DiagSection {
     id: string;
     query(root: HTMLElement): HTMLElement | null;
     clear(el: HTMLElement): void;
     render(el: HTMLElement, snapshot: DiagnosticsSnapshot): void;
   }
   const SECTIONS: DiagSection[] = [storageSection, obsidianSection, aiSection, sqliteSection, migrationSection, ...];
   ```
   `querySections` / `clearSections` は `SECTIONS.map(s => s.query/clear)` のループに置換。`loadAndPopulate` は `SECTIONS.forEach(s => s.render(...))` のみに。
2. **`SectionElements` の14フィールド列挙を排除**: 各 section の query が要素を所有する
3. **dashboard.ts の issue report entry point を集約**: `registerReportBugButton(btn)` 1関数に（内部で遅延 controller 生成 + キュー + flush を所有）。`dashboard.ts:50-68` の pending 配列と flush 知識を移動
4. **回帰**: 診断パネルの e2e（dashboard-diagnostics）+ unit テスト

### 触ってはいけないもの

- `deriveMigrationStatus` / `renderMigrationSection`（PBI 09-03 で純粋化済み — render 関数本体は触らない、呼び出し構造だけ変更）
- `debugModeStore`（健康と判定済み）

## BDD受け入れシナリオ

```gherkin
Scenario: 新しい診断 section が1行で追加できる
  Given SECTIONS テーブルが存在する
  When  新しい section モジュールをテーブルに追加する
  Then  query/clear/render のライフサイクルが自動的に走り、既存 section に影響しない

Scenario: 診断データの再取得で全 section が一括クリアされる
  Given 診断パネルが mount されている
  When  refresh が走る
  Then  全 section が clear → render の順で更新される（既存 e2e と同一結果）
```

## 受け入れ基準

- [x] `querySections` / `clearSections` の switch が `SECTIONS` テーブルのループに置換されている
- [x] `dashboard.ts` の issue report キューが `registerReportBugButton` 1関数に集約されている（`issueReportEntry.ts` 新設 — panel → dashboard の依存も解消）
- [x] `dashboard-diagnostics` e2e + 診断パネル unit テスト全件 green（diagnostics 関連 e2e 4/4・unit 107 passed）
- [x] section 追加時の編集箇所が1行（テーブル）+ render 関数になる（SECTIONS テーブルの先頭コメントに記載）

## テスト戦略

- e2e: 既存 `dashboard-diagnostics.spec.ts` が回帰網
- 単体: deriveMigrationStatus / renderMigrationSection テストは据え置き

## 見積もり

1-2日

## Definition of Done

- [ ] 全BDDシナリオが完了している
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（diagnosticsPanel 先頭コメント）
