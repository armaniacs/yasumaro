# PBI: dashboard配下のtagsPanel.ts（旧パネル実装、デッドコード）を削除する

**作成日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟡軽微（削除前に本当に未使用か確認が必須。誤って現役コードを削除するリスクがある）

---

## 背景

`2026-07-26-23-fix-dashboard-dead-code-removal.md`（PBI-23）の実装中に発見。同PBIの対象
（`tagClusterPanel.ts`, `domainSearchPanel.ts`, `diagnosticsPanel.ts`）と同じパターンで、
`src/dashboard/tagsPanel.ts` も `main.ts`/`dashboard.ts` から参照されておらず、
`panels/staticForm/tagsSettingsPanel.ts`（新Panelベース実装、別名）に置き換わっている
可能性が高い。PBI-23のスコープには含まれていなかったため、別PBIとして起票する。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "tagsPanel" src/dashboard/main.ts src/dashboard/dashboard.ts
grep -rln "tagsPanel" src/dashboard/*.ts src/dashboard/panels/**/*.ts entrypoints/options/*.ts 2>/dev/null | grep -v "__tests__"
```

`initTagsPanel`（または同等のexport関数名）の呼び出し元がゼロであることを確認する。
PBI-23と同様に、`main.ts`が`panels/staticForm/tagsSettingsPanel.ts`（新実装）を参照している
一方、旧`tagsPanel.ts`は取り残されている可能性が高い。

`dashboard.test.ts`/`dashboard-handlers.test.ts`/`dashboard-obsidian-enabled.test.ts`に
`vi.mock('../tagsPanel.js', ...)`という死んだモックが残っている（PBI-23実装時に確認済み）ため、
削除時にこれらも併せて整理する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 未使用が確認されたtagsPanel.tsが削除される
  Given tagsPanel.tsの呼び出し元を確認する
  When main.ts/dashboard.tsのいずれからも参照されていないことが確認できる
  Then ファイルを削除する（対応するテストファイルがあれば併せて削除）

Scenario: 削除後もビルド・テストが成功する
  Given tagsPanel.tsを削除した後
  When npm run build && npm test を実行する
  Then 全て成功する
```

## 受け入れ基準
- [ ] `tagsPanel.ts` の現在のコードベースからの参照有無を確認する
- [ ] 未参照が確認された場合、ファイルを削除する（対応するテストファイルがあれば併せて削除）
- [ ] `dashboard.test.ts`/`dashboard-handlers.test.ts`/`dashboard-obsidian-enabled.test.ts`内の
      `vi.mock('../tagsPanel.js', ...)`（死んだモック）を削除する
- [ ] `npm run build` と既存テストスイートが全てパスする

## テスト戦略

### 統合テスト
- 削除後、`npm run build` が成功することを確認

## 実装アプローチ

1. `grep -rln` で参照有無を確認
2. 未参照であれば `tagsPanel.ts` と対応テストファイルを削除
3. 3つのdashboardテストファイル内の死んだ`vi.mock`を削除
4. ビルド・テストで回帰がないことを確認

## 見積もり

1pt

## 技術的考慮事項
- 依存関係: なし（削除のみ）
- 非機能要件: 保守性

## Definition of Done
- [ ] `tagsPanel.ts` の参照有無が確認されている
- [ ] 未使用であれば削除されている
- [ ] 死んだ`vi.mock`が削除されている
- [ ] ビルド・テストが全て成功する
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- 発見元PBI: `dev-docs/archived/pbi/2026-07-26-23-fix-dashboard-dead-code-removal.md`
- 対象コード: `src/dashboard/tagsPanel.ts`

## 調査結果（2026-07-26、対応不要と判明しクローズ）

着手前調査の結果、`tagsPanel.ts`はPBI-23で削除した3ファイル（`tagClusterPanel.ts`等）と
**同じパターンではなかった**。

```bash
grep -rln "tagsPanel" src/dashboard/*.ts src/dashboard/panels/**/*.ts
# → src/dashboard/tagsPanel.ts, src/dashboard/panels/staticForm/tagsSettingsPanel.ts
```

`src/dashboard/panels/staticForm/tagsSettingsPanel.ts:2`が
`import { initTagsPanel } from '../../tagsPanel.js';`という形で**旧`tagsPanel.ts`を現役で
importしている**ことを確認した。さらに`tagsSettingsPanel.ts`自体は
`src/dashboard/main.ts:17`から`createTagsSettingsPanel`としてimportされ、新Panelベース
実装の一部として組み込まれている。

つまり依存チェーンは `main.ts` → `tagsSettingsPanel.ts` → `tagsPanel.ts`（`initTagsPanel`）
であり、`tagsPanel.ts`は「取り残された旧実装」ではなく「新実装から利用される現役モジュール」
だった。削除するとビルドが壊れる。

**対応**: 削除不要。本PBIはクローズする。
