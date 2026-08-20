# PBI: Dashboard Panel Abstraction Wave 2 — diagnosticsPanel Direct Implementation

**Date:** 2026-08-21  
**Priority:** High (2nd hotspot: 19 commits)  
**Estimation:** 2 points (1-2 days)

---

## ユーザーストーリー

**As a** チーム開発者  
**I want to** diagnosticsPanel が adaptLegacyPanel ラッパーなしに PanelLifecycle を直接実装する  
**So that** 診断機能の lifecycle が統一され、パネル移行パターンが確立される

---

## ビジネス価値

### 主要価値
1. **パターン確立**: Wave 1 の sqliteHistoryPanel に続いて、2 番目のパネル移行で pattern を検証・改善
2. **品質向上**: diagnosticsPanel (537 行, 19 commits) のテスト性向上
3. **技術債削減**: adaptLegacyPanel 依存を 1 つ削除

### 測定方法
- ✓ テスト成功率 100% (既存テスト + 新規 lifecycle テスト)
- ✓ 型チェック pass
- ✓ adaptLegacyPanel 呼び出し削除

---

## 現状とリスク分析

### 現在の実装状況
```typescript
// src/dashboard/panels/diagnostic/diagnosticsPanel.ts
export function createDiagnosticsPanel(): DiagnosticPanel {
  return { id, category, mount, loadData, refresh, unmount }
}

// src/dashboard/main.ts
adaptLegacyPanel(createDiagnosticsPanel()),  // ← 削除対象
```

### なぜなぜ分析: なぜ diagnosticsPanel から始めるのか？

**Question 1: Wave 1 の sqliteHistoryPanel 完成から、なぜ diagnosticsPanel を Wave 2 にするのか？**
- **Answer**: コミット頻度ベースの hotspot 特定
  - sqliteHistoryPanel: 26 commits (Wave 1 完成)
  - **diagnosticsPanel: 19 commits** ← 2 番目に活発
  - historyPanel: ~5 commits
  - 理由: 最近変更が多い = 移行で得られる価値が大きい

**Question 2: なぜ diagnosticsPanel は DiagnosticPanel interface を実装しているのか？**
- **Answer**: Chrome Extension UI パネルの legacy interface system
  - Wave 1 前に Panel 抽象がなかった
  - 診断パネルは専用 interface で実装
  - PanelLifecycle 定義後、適合させる必要がある

**Question 3: テストは既に存在するか？**
- **Answer**: 2 つのテストファイル存在
  - `DiagnosticsCollector.test.ts` (controller logic)
  - `diagnosticsPanel-builtInAi.test.ts` (built-in AI integration)
  - 同じパターンで lifecycle テストを追加

---

## BDD 受け入れシナリオ

```gherkin
Scenario: diagnosticsPanel が PanelLifecycle を直接実装し、adapter ラッパーなしに稼働する
  Given diagnosticsPanel がまだ adaptLegacyPanel でラップされている
  When diagnosticsPanel を PanelLifecycle interface の直接実装に変換する
  Then 全テスト pass かつ main.ts の adapter ラッパーが削除される

Scenario: lifecycle メソッド呼び出し順序が正しく、診断実行が完了する
  Given mount() でコンテナが初期化される
  When init() → load() → destroy() が順に呼ばれる
  Then 診断収集が完了し、UI がレンダリングされ、cleanup が実行される

Scenario: 既存の built-in AI 診断テストが pass する
  Given diagnosticsPanel が LocalAIService と連携している
  When PanelLifecycle 移行後に diagnosticsPanel-builtInAi.test.ts を実行
  Then 全テスト pass、AI 診断機能は変わらない
```

---

## 受け入れ基準

- [ ] diagnosticsPanel がディレクトリ（まず DiagnosticPanel 型） → PanelLifecycle 型を返す
- [ ] lifecycle メソッド mapping: mount → mount, refresh → init, loadData (なし) / activate → load, unmount → destroy
- [ ] 既存テスト 2 ファイル (DiagnosticsCollector.test.ts, diagnosticsPanel-builtInAi.test.ts) が全て pass
- [ ] 新規 lifecycle テスト (sqliteHistoryPanel.lifecycle.test.ts のパターンを適用) 作成
- [ ] main.ts で `adaptLegacyPanel(createDiagnosticsPanel())` → `createDiagnosticsPanel()` に変更
- [ ] npm run type-check pass
- [ ] npm run validate (lint + type-check + test) pass

---

## テスト戦略（t_wada スタイル Outside-In）

### E2E テスト（最小限）
- diagnosticsPanel が sidebar から選択できる（NavigationRegistry integration）

### 統合テスト（中程度）
- mount() → init() → load() → destroy() シーケンス検証
- DiagnosticsCollector との連携確認
- LocalAIService との連携確認（既存テスト）

### 単体テスト（多数）
- lifecycle テスト 15-20 ケース（Wave 1 の sqliteHistoryPanel パターンを再利用）
  - mount() 初期化
  - init() パラメータ処理（なし）
  - load() 非同期実行
  - destroy() cleanup
  - シーケンス検証

### テストピラミッド
```
E2E (UI integration test)
  1 テスト
  ├─ sidebar から diagnosticsPanel 選択 → lifecycle 実行
統合テスト
  5 テスト
  ├─ mount → init → load → destroy sequence
  ├─ DiagnosticsCollector 連携
  ├─ built-in AI 実行
  └─ error handling
単体テスト（lifecycle）
  15-20 テスト
  ├─ interface compliance
  ├─ mount/init/load/destroy 各メソッド
  └─ sequence validation
```

---

## 実装アプローチ

### Outside-In テスト駆動開発（TDD）

1. **E2E テスト fail**: sidebar から diagnosticsPanel 選択 → 既存の lifecycle がまだ DiagnosticPanel 型
2. **統合テスト fail**: PanelLifecycle 型が未定義
3. **単体テスト fail**: lifecycle メソッドが未実装
4. **実装**: diagnosticsPanel を PanelLifecycle に変換
5. **グリーン**: 全テスト pass
6. **リファクタ**: 不要なコード削除、pattern 最適化

### 具体的な実装手順

**Step 1: Interface 型変換**
```bash
# src/dashboard/panels/diagnostic/diagnosticsPanel.ts
# DiagnosticPanel → PanelLifecycle に変更
```

**Step 2: Lifecycle メソッド実装**
```typescript
// before
{
  id, category, mount, loadData, refresh, unmount
}

// after（Wave 1 パターンを適用）
{
  id, category, mount, init, load, destroy
}
```

**Step 3: main.ts 統合**
```bash
# src/dashboard/main.ts
adaptLegacyPanel(createDiagnosticsPanel()) → createDiagnosticsPanel()
```

**Step 4: テスト更新**
- 既存テストの型を DiagnosticPanel → PanelLifecycle に変更
- loadData → load, unmount → destroy に置換
- 新規 lifecycle テスト作成（sqliteHistoryPanel.lifecycle.test.ts パターン再利用）

**Step 5: 検証**
```bash
npm run test -- diagnosticsPanel
npm run type-check
npm run validate
```

---

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）
```bash
# 現在の DiagnosticPanel interface 定義確認
grep -n "interface DiagnosticPanel" src/dashboard/panels/types.ts

# diagnosticsPanel の現在実装確認
grep -n "export function createDiagnosticsPanel" src/dashboard/panels/diagnostic/diagnosticsPanel.ts

# 既存テストの型確認
grep -n "DiagnosticPanel" src/dashboard/panels/diagnostic/__tests__/*.test.ts
```

### Wave 1 との主な違い
- **loadData vs load**: diagnosticsPanel には loadData がない（refresh のみ）
  - **なぜ?** 診断は mount 直後に自動実行（refresh は手動）
  - **対応**: load() は自動実行コードを呼ぶ（refresh の兼用）

- **init パラメータ**: diagnosticsPanel は init パラメータを使わない
  - **なぜ?** 診断パラメータはない（固定実行）
  - **対応**: init(initParams?) は空実装可能

### 落とし穴
1. **refresh() の扱い**: 
   - 既存: refresh?() は optional
   - 新: load() に統合するか、別で保持するか判断
   - **推奨**: load() に統合。refresh は UI からのリロード時に load() を再呼び出し

2. **error handling**:
   - diagnosticsPanel は エラー状態を "errors" フィールドで保持
   - destroy() でこれをクリア

3. **テスト時の LocalAIService**:
   - 既存テスト (diagnosticsPanel-builtInAi.test.ts) が LocalAIService をモック
   - 型変更時にモックも確認

---

## Definition of Done

- [ ] diagnosticsPanel が PanelLifecycle を直接実装
- [ ] adaptLegacyPanel ラッパー削除（main.ts）
- [ ] 既存テスト 2 ファイル全て pass
- [ ] 新規 lifecycle テスト 15-20 ケース作成・pass
- [ ] npm run validate (lint + type-check + test) pass
- [ ] コードレビュー完了
- [ ] リファクタ完了（冗長コード削除）
- [ ] ADR で Wave 2 learnings 記録（診断パネル固有の特性、パターン改善点）

---

## 参考資料

- [ADR 2026-08-20: Panel Lifecycle Wave 1](../dev-docs/ADR/2026-08-20-panel-lifecycle-wave1.md)
- [Wave 1 実装: commit e714b050](https://github.com/armaniacs/yasumaro/commit/e714b050)
- [PanelLifecycle interface](src/dashboard/panels/types.ts)
- [NavigationRegistry](src/dashboard/panels/NavigationRegistry.ts)

---

## 次の Wave への接続

**Wave 3**: 残り 8 パネル（historyPanel, tagClusterPanel, 他）
- **依存**: Wave 2 (diagnosticsPanel) が完成してから開始
- **パターン**: Wave 1-2 で確立した pattern を適用
- **見積もり**: 各 2 points × 8 panels = 2 weeks
