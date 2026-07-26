# PBI: dashboard配下の旧パネル実装（デッドコード）を削除する

**作成日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（削除前に本当に未使用か確認が必須。誤って現役コードを削除するリスクがある）

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Maintainability Guardian からの指摘。`src/dashboard/tagClusterPanel.ts`, `domainSearchPanel.ts`, `diagnosticsPanel.ts` がPanelベース移行後も削除されず残存している。保守担当者が誤ったファイルを変更するリスクがある。`tagCooccurrence.ts`, `tagClusterLayout.ts` も同様に確認が必要。

**2026-07-26時点の調査で、3ファイルとも `src/dashboard/` に実在することを確認した。**

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
ls src/dashboard/tagClusterPanel.ts src/dashboard/domainSearchPanel.ts src/dashboard/diagnosticsPanel.ts src/dashboard/tagCooccurrence.ts src/dashboard/tagClusterLayout.ts
grep -rln "tagClusterPanel\|domainSearchPanel\|diagnosticsPanel\|tagCooccurrence\|tagClusterLayout" src/dashboard/*.ts entrypoints/options/*.ts 2>/dev/null | grep -v "__tests__"
```

**アーカイブ済みPBI一覧に `2026-07-21-03-refactor-dedup-diagnostics-panel.md` が存在する**（既に対応済みの可能性がある）。このPBIの内容を確認し、今回の指摘が重複でないか、または部分的にしか対応されていないかを確認する。既存のPanelベース実装（`src/dashboard/panels/` 配下）から実際にこれらの旧ファイルが参照されているかを確認し、参照ゼロであれば安全に削除できる。

## 受け入れ基準（BDD）

```gherkin
Scenario: 未使用が確認された旧パネルファイルが削除される
  Given tagClusterPanel.ts, domainSearchPanel.ts, diagnosticsPanel.ts の呼び出し元を確認する
  When これらのファイルがどこからも参照されていないことが確認できる
  Then ファイルを削除する

Scenario: 現役で使われているファイルは誤って削除しない
  Given tagCooccurrence.ts, tagClusterLayout.ts が実際に現在のPanelベース実装から参照されている
  When 削除の要否を判断する
  Then 参照が確認できたファイルは削除しない

Scenario: 削除後もビルド・テストが成功する
  Given 未使用ファイルを削除した後
  When npm run build && npm test を実行する
  Then 全て成功する
```

## 受け入れ基準
- [ ] `tagClusterPanel.ts`, `domainSearchPanel.ts`, `diagnosticsPanel.ts`, `tagCooccurrence.ts`, `tagClusterLayout.ts` それぞれについて、現在のコードベースからの参照有無を確認する
- [ ] アーカイブ済みPBI `2026-07-21-03-refactor-dedup-diagnostics-panel.md` の内容を確認し、重複対応がないか確認する
- [ ] 未参照が確認されたファイルを削除する（対応するテストファイルがあれば併せて削除）
- [ ] `npm run build` と既存テストスイートが全てパスする

## テスト戦略

### 統合テスト
- 削除後、`npm run build` が成功することを確認
- dashboard全体の機能（実際のPanelベースUI）が正常動作することを手動確認

## 実装アプローチ

1. アーカイブ済みPBI `2026-07-21-03-refactor-dedup-diagnostics-panel.md` を確認
2. `grep -rln` で各ファイルの参照有無を確認
3. 未参照ファイルとその対応テストファイルを削除
4. ビルド・テストで回帰がないことを確認

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: なし（削除のみ）
- 非機能要件: 保守性

## Definition of Done
- [ ] 各ファイルの参照有無が確認されている
- [ ] 未使用ファイルが削除されている
- [ ] ビルド・テストが全て成功する
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Maintainability Guardian指摘）
- 関連する可能性のあるアーカイブ済みPBI: `dev-docs/archived/pbi/2026-07-21-03-refactor-dedup-diagnostics-panel.md`
- 対象コード: `src/dashboard/tagClusterPanel.ts`, `domainSearchPanel.ts`, `diagnosticsPanel.ts`, `tagCooccurrence.ts`, `tagClusterLayout.ts`
