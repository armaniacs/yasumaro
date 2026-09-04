# PBI 03: popup フィードバックの薄いラッパー 2 件を削除

優先度: 3 位 / RICE 15.0 = (3 × 0.5 × 100%) / 0.1w / Strength: Strong（deletion-first）
backlog: [2026-09-05-00-backlog-arch4.md](2026-09-05-00-backlog-arch4.md)
依存: なし（他 6 件と独立。PBI 06（Round 3）の RecordSession の後始末）

## ユーザーストーリー
popup を保守する開発者として、`SpinnerManager`（15 行）と `ErrorPresenter`（17 行）の pass-through ラッパーが消えてほしい。なぜなら interface が implementation と同一であり、モック用に seam を1つずつ増やす設計が spinner 所有権をセッションと fetcher に分散させているから。

## BDD受け入れシナリオ

```gherkin
Scenario: ラッパーなしに spinner/エラー表示ができる
  Given RecordSession の private helper 化後
  When  記録フロー（成功・失敗・private-page）を実行する
  Then  spinner 表示・エラー表示が従来どおりに行われる

Scenario: fetcher が spinner を直接所有しない
  Given TabContentFetcher
  When  権限 ladder を実行する
  Then  spinner 制御がセッション側の一箇所から行われる
```

## 受け入れ基準
- [x] `spinnerManager.ts` と `errorPresenter.ts` が削除され、`RecordSession` の private helper になる（または show/hide/showError を束ねた 1 狭窄モジュールになる。いずれか1形態）
- [x] `TabContentFetcher` が `SpinnerManager` を受け取らない（spinner 所有権がセッションに一本化）
- [x] `recordCurrentPage.ts` の再エクスポートから 2 件が消える
- [x] モック注入箇所が減り、既存 popup テストがセッション seam 経由に整理されて green
- [x] 文言・表示タイミングが変更前と同一

## テスト戦略（t_wadaスタイル）
### 単体テスト
- セッション駆動の成功/失敗/private-page で spinner・エラー表示のアサーション（fake fetcher/preview）
### 統合テスト
- 既存 popup suite はモック整理のみで green
### 例外ハンドリング
- 変更なし（表示文言・タイミング不変）

## 実装アプローチ
- **Deletion-first**: 参照箇所の洗い出し → セッション内 private 化 → wrapper 削除 → モック整理

## 見積もり
0.1w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: セッション seam 越しの検証に一本化。2 adapter モックが不要になる
- 非機能要件: 削除のみ。`popup/spinner.ts` / `popup/errorUtils.ts` の実体は残る

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "SpinnerManager|ErrorPresenter" src/popup/ --include="*.ts" | grep -v __tests__ | head -20
```
2026-09-05 時点: `RecordSession` コンストラクタ注入 4 点のうち 2 点が pass-through。`TabContentFetcher` も `SpinnerManager` を取る。

### 実装手順
1. 参照箇所を `rg` で全洗い出し
2. セッション private helper 化（show/hide/showError＋buildPrivatePageErrorMessage）
3. fetcher の spinner 注入を除去し、セッションが ladder 前後で制御
4. wrapper 2 ファイルを削除、再エクスポートを整理、テスト green

### 落とし穴
- `buildPrivatePageErrorMessage` の i18n キー組み立て（`privatePageReason_*`）は文言不変で移動すること
- fetcher の permission ladder 中の spinner 表示タイミングを変えないこと（表示の有無ではなく所有権の移動）
- テストの `createMocks()` から 2 モックを除去する際、(o as any) 経由の private 参照が残らないよう確認

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] popup 全テスト green
- [x] コードレビュー完了
- [x] ドキュメント更新（不要。削除のみ）
