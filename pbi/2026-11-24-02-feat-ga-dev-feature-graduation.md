# PBI: 開発中 4 機能の正式版での扱いを判定する

## ユーザーストーリー
プロジェクトの owner として、サイドバーの「開発中」区分にある 4 機能(保存済みコレクション、履歴に聞く、調査レポート、webhook export)を正式版で昇格させるか開発中のまま残すかを、同じ判定基準と根拠のそろった材料で決めたい、なぜなら判定材料が散らばったままだと、正式版の掲載文・README・実機スモークの対象が決まらず、未成熟な機能を「正式版の機能」として利用者に提示してしまうから。

## 優先度
- 順位: 01/12
- RICE: 6.4(Reach 8 × Impact 2 × Confidence 0.8 / Effort 2)
  - Reach 8: 正式版の利用者の大半が設定画面のサイドバーで 4 機能を目にする
  - Impact 2: 正式版で何を「完成した機能」と呼ぶかが決まり、掲載文と README の記述が確定する
  - Confidence 0.8: 判定そのものは owner の裁定で、材料の収集範囲には設計判断が残る
  - Effort 2: コード変更はなく、テスト・不具合・文書の棚卸しと ADR 1 本の作成
- 根拠と依存: 02(SHA256 と provenance)と同点だが、本 PBI は 04(正式版リリース準備)の掲載文・機能一覧と、08(実機スモーク)の対象範囲の前提になるため先に置く。本 PBI 自体の依存はない

## ビジネス価値
- 正式版で提示する機能の範囲が、根拠付きで一度に決まる
- 「開発中」の表示と README・掲載文の記述が、同じ判定から導かれ食い違わなくなる
- 測定方法: 4 機能すべてについて、判定基準の各項目の材料と owner の裁定(昇格/開発中のまま)が ADR に記録されていること

## BDD受け入れシナリオ

```gherkin
Scenario: 4 機能の判定材料がそろい、owner の裁定が記録される
  Given サイドバーの「In Development」区分に 4 機能が並んでいる
  When  判定基準の表に沿って各機能の材料を集め、owner が裁定する
  Then  ADR に 4 機能それぞれの判定材料と裁定(昇格/開発中のまま)が記録される
  And   ADR の一覧(dev-docs/ADR/README.md)に新しい ADR が登録されている

Scenario: 材料が不足する機能は「判定保留」として理由付きで残る
  Given ある機能で、既知の不具合の有無やデータ損失リスクが確認できない
  When  判定表を作る
  Then  その機能の該当欄は「要確認」と書かれ、推測で埋められない
  And   owner の裁定欄は「保留」となり、昇格の前提として何を確認すべきかが書かれる

Scenario: 外部送信を伴う機能は、外部送信の項目が空のまま昇格しない
  Given webhook export は利用者が設定した宛先へ記録を送る
  When  判定表の「外部送信の有無」の欄を埋める
  Then  送信内容・宛先の制限・既定値(オプトインかどうか)が文書とコードの両方で確認されている
  And   確認できない場合、昇格の判定は「保留」になる
```

## 受け入れ基準
- [ ] 判定基準の表(下記)の全項目について、4 機能の材料が埋まっている(不明は「要確認」と明記)
- [ ] 判定結果が ADR(推奨パス: `dev-docs/ADR/2026-11-24-ga-dev-feature-graduation.md`)に記録され、`dev-docs/ADR/README.md` の一覧に登録されている
- [ ] 各機能の裁定欄は owner が記入する。PBI の実装者は裁定を代行しない
- [ ] 昇格した機能について、後続で必要な作業(サイドバー区分の移動、README の「開発中の機能」表記の削除、掲載文への追加)が ADR に列挙され、04 の受け入れ基準から参照できる
- [ ] 09(必須 host_permissions の最小化)を正式版と同時に入れるか GA 後に回すかの裁定も、同じ ADR に記録されている
- [ ] コード(`src/`・`entrypoints/`)に変更がない

### 判定基準(全機能共通)

| 項目 | 確認する内容 | 昇格の目安 |
|---|---|---|
| テスト網羅 | 単体・統合・E2E の有無と、主要な BDD シナリオがテストで検証されているか | 単体と E2E の両方があり、主要シナリオが緑 |
| 既知の不具合 | 未完了の PBI、GitHub Issues、handoff の未解決事項 | 利用者影響のある未解決の不具合がない |
| データ損失リスク | 保存形式(storage キー・SQLite)の版管理、移行の有無、削除・上書きの経路 | 保存形式に版があり、上書き・削除で既存データを失わない |
| 外部送信の有無 | 送信先、送信内容、既定値(オプトインか)、PRIVACY.md / PERMISSIONS.md への記載 | 外部送信なし、またはオプトインで文書に記載済み |
| ドキュメント有無 | README(日英)、docs/ の利用者向けガイド、i18n(en/ja) | 日英の README と利用者向けの説明がある |

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- 追加しない。既存 E2E の実行結果を材料として記録する
  - `testDir/e2e/saved-collections-panel.spec.ts`
  - `testDir/e2e/ask-history.spec.ts` / `testDir/e2e/ask-history-panel.spec.ts`
  - `testDir/e2e/research-report-panel.spec.ts`
  - `testDir/e2e/webhook-egress.spec.ts`

### 統合テスト
- 追加しない。メッセージ経路(gateway と handler)の既存テストの有無を材料として記録する

### 単体テスト
- 追加しない。各機能の単体テストの件数と対象モジュールを記録する

## 実装アプローチ
- **Outside-In**: 先に判定表の空欄を ADR の雛形として作り、外側(利用者に見える文書・E2E)から内側(単体テスト・保存形式)へ材料を埋める
- **Red-Green-Refactor**: コード変更がないため対象外。空欄(Red)を材料で埋め(Green)、重複する記述を ADR 内で整理する(Refactor)

## 見積もり
2 ストーリーポイント(要チームでの見積もり)

## 技術的考慮事項
- 依存関係: なし。ただし 2026-11-24-01(webhook export のサイドバー区分移動、完了)により webhook export は既に「開発中」区分にある
- テスタビリティ: 判定は文書だけで完結する。材料の再現性のため、使ったコマンドと結果(件数・緑赤)を ADR に残す
- 非機能要件: ADR は Shift-JIS 範囲の文字のみ(`npm run check:docs-chars`)。ADR 一覧のリンクは `npm run lint:adr-links` で検査される

## 実装者向け注記

### 現状コードの確認
確認済み(2026-11-24)。4 機能はすべて `sidebarSection: 'experimental'`。

```bash
rtk grep -n "experimental" /Users/yaar/Playground/yasumaro/src/dashboard/panels/panelCatalog.ts
rtk grep -n "experimentalSection" /Users/yaar/Playground/yasumaro/entrypoints/options/index.html
```

| 機能 | パネル ID | 主なモジュール(確認済み) | E2E(確認済み) |
|---|---|---|---|
| 保存済みコレクション | `panel-saved-collections`(`tabParam: 'collections'`) | `src/dashboard/panels/asyncData/savedCollectionsPanel.ts`、`savedCollectionsPanelView.ts`、`savedCollectionQuery.ts`、`src/utils/storage/savedCollections.ts`、`src/utils/storage/savedCollectionsRepository.ts`、`src/utils/collectionQueryV2.ts` | `testDir/e2e/saved-collections-panel.spec.ts` |
| 履歴に聞く | `panel-ask-history`(`tabParam: 'ask-history'`) | `src/dashboard/panels/asyncData/askHistoryPanel.ts`、`src/background/handlers/askHistoryHandlers.ts`、`src/background/askEvidence.ts`、`src/messaging/askHistoryGateway.ts` | `testDir/e2e/ask-history.spec.ts`、`ask-history-panel.spec.ts` |
| 調査レポート | `panel-research-report`(`tabParam: 'research-report'`) | `src/dashboard/panels/asyncData/researchReportPanel.ts`、`src/background/researchReportGenerator.ts`、`src/background/handlers/researchReportHandlers.ts`、`src/messaging/researchReportGateway.ts` | `testDir/e2e/research-report-panel.spec.ts` |
| webhook export | `panel-webhook-export`(`tabParam` なし) | `src/background/webhookExport/`(Destinations / History / Payload / Sender / Settings)、`src/background/pipeline/steps/webhookExportStep.ts`、`src/dashboard/webhookExportSettings.ts` | `testDir/e2e/webhook-egress.spec.ts` |

材料集めの起点(確認済みの事実):
- 外部送信: 履歴に聞くは handler 冒頭のコメントで「外部送信なし(mode 'local_only')」。調査レポートは既存のローカル Markdown ダウンロードと Obsidian デイリーノート追記(任意)だけを使う(`researchReportGenerator.ts` 冒頭)。webhook export は利用者設定の https 宛先へマスク済みタイトル・要約・タグ・URL を送る(`docs/PRIVACY.md`、`PERMISSIONS.md`、`SECURITY.md` の Scope に記載)
- 保存形式: webhook は `webhook_export_settings_v1` と `webhook_export_history_v1`(版付きキー)。保存済みコレクションの永続化先(chrome.storage か SQLite か、キー名と版)は `savedCollectionsRepository.ts` から読み取れず「要確認」
- ドキュメント: README 日本語の機能一覧では 3 機能に「(開発中の機能)」と付くが、英語側(Features)には付いていない。webhook export は README の機能一覧に項目がなく、セキュリティ節と `docs/MCP_BRIDGE_RECIPE.md` に記載がある
- 履歴に聞くは端末内モデルに依存する。README の Firefox 版の既知の制限(ブラウザ内蔵 AI 非対応)との関係は「要確認」

```bash
rtk grep -n "開発中の機能\|Saved Collections\|Ask Your History\|Research Report" /Users/yaar/Playground/yasumaro/README.md
rtk grep -rn "webhook" /Users/yaar/Playground/yasumaro/docs/PRIVACY.md /Users/yaar/Playground/yasumaro/PERMISSIONS.md /Users/yaar/Playground/yasumaro/SECURITY.md
rtk grep -rli "webhook\|保存済みコレクション\|履歴に聞く\|調査レポート" /Users/yaar/Playground/yasumaro/pbi --exclude=00-INDEX.md
gh issue list --repo armaniacs/yasumaro --state open --limit 100
```

### 範囲
- 含める: 判定基準の表、4 機能の材料、ADR の作成と一覧登録、owner の裁定欄、09 を GA に含めるかの裁定欄
- 含めない: サイドバー区分の移動、README・掲載文の書き換え(04 で行う)、機能の修正

### 実装手順
1. `dev-docs/ADR/README.md` の書式(表の列: #, タイトル, 日付, ステータス)を確認し、ADR を「提案中」で作る
2. 判定基準の表を ADR に置き、4 機能 × 5 項目の空欄を作る
3. 各機能について、E2E と単体テストを個別に実行して結果を記録する(例: `npx vitest run src/dashboard/panels/asyncData/__tests__/savedCollectionsPanel.test.ts`。E2E の実行方法は `testDir/playwright.config.ts` と CONTRIBUTING.md を確認する)
4. 既知の不具合: 未完了 PBI(`pbi/` 直下)、`pbi/handoff/`、GitHub Issues を確認して記録する
5. データ損失リスク: 保存キーと版、削除・上書き経路を記録する。保存済みコレクションの永続化先はコードを追って特定する
6. 外部送信とドキュメントの欄を埋める
7. owner に裁定を依頼し、裁定欄とステータス(採用済み)を更新する。昇格した機能の後続作業を列挙する
8. `npm run lint:adr-links` と `npm run check:docs-chars` を実行する

### 落とし穴
- 判定は owner の裁定事項。材料から「昇格すべき」と結論を書き込まない。推奨を書く場合は「推奨」と明示し、裁定欄とは分ける
- 昇格すると、サイドバー区分を `panelCatalog.ts` と `entrypoints/options/index.html` の両方で移す必要がある(片方だけだと整合テストが赤)。その作業は本 PBI では行わず、ADR に列挙するだけ
- `experimental` から外した機能に `tabParam` があると、既存のディープリンクが残る。移動先区分でも `?tab=` が動くかを後続作業の注意として ADR に書く
- E2E が環境依存で落ちた場合、「赤」と記録する前に再現条件を確認する(dev-docs/TEST_RULE.md の実時間待ちの節)

## Definition of Done
- [ ] 全 BDD シナリオが ADR の記述で満たされている
- [ ] ADR が一覧に登録され、`npm run lint:adr-links` と `npm run check:docs-chars` が緑
- [ ] owner の裁定が 4 機能すべてと 09 について記入されている(保留を含む)
- [ ] 04 と 08 の担当者が参照できるよう、台帳(2026-11-24-00-backlog-ga-release.md)から ADR へのリンクがある
- [ ] コードレビュー(文書レビュー)完了

## 引き継ぎ
状態: 材料収集中(裁定待ち)。進捗と引き継ぎ情報は [handoff/2026-11-24-02-feat-ga-dev-feature-graduation.md](handoff/2026-11-24-02-feat-ga-dev-feature-graduation.md) に記録した。ADR は提案中で作成・一覧登録済み。owner の裁定後にステータスを更新する。
