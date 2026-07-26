# PBI: popupの設定UIをダッシュボードに一本化する

**作成日**: 2026-07-26
**優先度**: Low
**見積もり**: 🔴高（3pt以上目安。当初2ptから再見積もり、理由は下記「実装時の追加調査」参照）
**副作用**: 🔴あり（当初「軽微」と想定していたが、popup/dashboard間でDOM IDを共有する設計のため、削除範囲を誤ると両方の機能を壊すリスクがある。再見積もりによりフェーズ3〔副作用あり〕へ移動）

---

## 前提条件（依存PBI）

**`pbi/2026-07-26-37-fix-dashboard-general-missing-settings.md`（PBI-37）は完了済み（2026-07-26、アーカイブ済み）。**

フェーズ0調査の結果、popup側4タブ（General/Domain Filter/Prompt/Privacy）のうち
Domain Filter・Prompt・Privacyはdashboard側に同等の設定項目が既に存在すると確認していたが、
Generalタブの一部項目（min_visit_duration, min_scroll_depth, max_tokens_per_prompt）は
dashboard側に存在しなかった。PBI-37で追加済み。
（`ai_summary_cleansing_body_protection_enabled`はPBI-37調査時に対象外と判明。詳細はPBI-37参照）

## 実装時の追加調査（2026-07-26、着手→保留の経緯）

PBI-37完了後に本PBIに着手し、「settingsScreen全体を誘導リンクに置き換える」実装を進めるべく
依存関係を調査したところ、**当初想定より大幅に大きいスコープ**であることが判明し、着手を保留した。

### 判明した事実

1. `#menuBtn`は既に`showSettingsScreen()`（`src/popup/navigation.ts:60-70`）経由で
   ダッシュボード（`options.html`）を新規タブで開き`window.close()`する実装になっている。
   `settingsScreen`のDOMを表示するコードパスは既に存在しない（UI体験としては誘導リンク化済み）
2. Export/Import機能（`exportSettingsBtn`/`importSettingsBtn`）、MasterPassword機能は
   dashboard側`panel-export-import`/`panel-privacy`に同一IDで存在し機能欠落なし
3. **重要な問題**: `src/popup/domainFilter.ts`はpopup専用ファイルではなく、
   `src/dashboard/domainFilterTagUI.ts`と`src/dashboard/exportImport.ts`から
   `loadDomainSettings`をimportされている**popup/dashboard共有モジュール**。
   dashboard側`panel-domain`は意図的に`domainFilter.ts`と同一の隠しDOM ID
   （`filterDisabled`, `domainList`, `whitelistTextarea`, `blacklistTextarea`,
   `saveDomainSettings`等、`hidden`属性付き）を使い、popup側のロジックをそのまま再利用する設計
4. 同様のパターンが`promptPanel`（`promptList`, `promptName`, `promptText`等）と
   `privacyPanel`（`modeA`, `modeB`, `privacyModeMaskedCloud`, `piiConfirm`,
   `masterPasswordEnabled`等）でも、dashboard側`panel-prompt`/`panel-privacy`に
   同一IDが存在することを確認済み（`customPromptManager.ts`/`privacySettings.ts`が
   同様の共有モジュールである可能性が高いが、未確認）

### これが意味すること

`entrypoints/popup/index.html`の`settingsScreen`を単純に削除すると、
`domainFilter.ts`等の共有モジュールのトップレベル`document.getElementById`呼び出しが
`null`を返すようになる（nullチェックがあるためクラッシュはしないが、popup側で
これらのモジュールを初期化する意味がなくなる）。安全に削除できる範囲を確定するには、
**popup/dashboard間でDOM IDを共有する全モジュール**（`domainFilter.ts`,
`customPromptManager.ts`, `privacySettings.ts`, その他`settingsScreen`配下の
全パネルに関連するモジュール）の依存関係を一つずつ洗い出す必要がある。

これは「タブUIを誘導リンクに置き換える」という軽微な変更ではなく、
**popup/dashboard間の共有アーキテクチャを理解した上での慎重なリファクタリング**であり、
当初見積もり（2pt）を大幅に超える。ユーザー判断によりフェーズ3（副作用あり、1件ごと確認）に
移動し、次のPBIへ進む。

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の UI Expert からの指摘。`entrypoints/popup/index.html` と `entrypoints/options/index.html` で設定UIが重複している。ユーザーがどちらを使うべきか混乱し、両方操作すると互いに上書きする可能性がある。提案は「ポップアップの設定画面（4タブ全体）を廃止し、ダッシュボードに統一誘導する」こと。

## 実装者向け注記: 現状の確認（フェーズ0調査済み・2026-07-26実施）

着手前に必ず実行すること（PBI-37完了後、差分がないか再確認）:

```bash
grep -n "data-storage-key=" entrypoints/popup/index.html
grep -n "data-storage-key=" entrypoints/options/index.html
```

### 調査済み結果

popup側は `mainScreen`（記録ボタン・ステータス表示、15行目〜）と `settingsScreen`
（209行目〜、4タブ構成）の2画面構造。4タブ（`generalTab`/`domainTab`/`promptTab`/`privacyTab`）は
すべて1つの`settingsScreen`にまとまっており、個別にではなく**画面全体を一括で**誘導リンクに
置き換える（ユーザー承認済み: 2026-07-26）。

dashboard側には `panel-general`/`panel-domain`/`panel-prompt`/`panel-privacy` が存在し、
Obsidian接続・AIプロバイダー各種・Domain Filter・Promptカスタマイズ・Privacyの各設定は
既に同一の`data-storage-key`で重複実装済み（PBI-37完了後は全項目が網羅される）。
dashboardには他にもpopupにない設定パネル（Content, AI Summary Cleansing, Trust, CSP, Tags,
Tag Cluster, SQLite History, Domain Search, Export Logs, Recording Conditions, Diagnostics,
Export/Import）が存在し、dashboardの方が包括的な実装である。

「#menuBtn がダッシュボードを新規タブで開く」という既存の導線（メモリに記録あり）を活用する。

## 受け入れ基準（BDD）

```gherkin
Scenario: popupの設定画面（4タブ全体）がダッシュボードへの誘導に置き換わる
  Given popup UIに設定画面（settingsScreen、General/Domain Filter/Prompt/Privacyの4タブ）がある
  When ユーザーが設定画面を開こうとする
  Then 個別タブの代わりに「詳細設定はダッシュボードで」という案内とダッシュボードへのリンクが表示される

Scenario: ダッシュボードで全ての設定が引き続き利用可能である
  Given popupから設定機能（settingsScreen全体）が削除された
  When ユーザーがダッシュボードを開く
  Then 従来popupにあった設定項目が全てダッシュボードで設定可能である（機能欠落がない。PBI-37完了が前提）

Scenario: popup固有の機能は維持される
  Given popup UIの記録ボタン・ステータス表示等（mainScreen）
  When 設定UI統一後のpopupを確認する
  Then これらの機能は変更されず引き続き動作する
```

## 受け入れ基準
- [ ] PBI-37（ダッシュボード側の機能欠落解消）が完了していることを確認する
- [ ] popup側の`settingsScreen`（4タブ全体）と`mainScreen`（記録・ステータス表示）を明確に切り分ける
- [ ] `settingsScreen`を、ダッシュボードへの誘導リンク（既存の`#menuBtn`の仕組みを活用）に置き換える
- [ ] ダッシュボード側に、popupから削除される設定項目が全て存在することを再確認する（機能欠落がないことを確認）
- [ ] 既存の popup/dashboard 関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 統合テスト（手動）
- 実ブラウザでpopupを開き、設定関連UIがダッシュボード誘導に置き換わっていることを確認
- ダッシュボードで全設定項目が利用可能であることを確認

### 単体テスト
- 既存のpopup関連テストが、設定UI削除後も回帰しないことを確認（設定UI依存のテストは更新が必要）

## 実装アプローチ

1. PBI-37完了を確認（ダッシュボード側の機能欠落解消）
2. popup側の`settingsScreen`（4タブ全体）と`mainScreen`を明確に切り分ける
3. `settingsScreen`をダッシュボードへの誘導リンクに置き換える
4. `src/popup/main.ts`/`src/popup/navigation.ts`等から不要になった設定タブ初期化コードを削除
5. 既存テストを更新し回帰確認

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `entrypoints/popup/index.html`, `entrypoints/options/index.html`
- テスタビリティ: 既存のpopup/dashboardテストが土台
- 非機能要件: UX（操作導線の一貫性）

## Definition of Done
- [ ] popup側の設定UIがダッシュボード誘導に置き換わっている
- [ ] ダッシュボードで機能欠落がないことが確認されている
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（UI Expert指摘）
- 前提PBI: `pbi/2026-07-26-37-fix-dashboard-general-missing-settings.md`（PBI-37）
- 対象コード: `entrypoints/popup/index.html`, `entrypoints/options/index.html`
