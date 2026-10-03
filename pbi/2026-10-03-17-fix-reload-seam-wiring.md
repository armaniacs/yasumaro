# PBI: reload-general-settings イベントが未接続・PanelLifecycle.refresh が未呼び出し（設定インポート後の全般/provider 設定 stale）

## ユーザーストーリー

設定をインポート・復元したいユーザーとして、反映後のダッシュボード画面に最新の全般設定が表示されてほしい。現状は domain/privacy/content は更新されるが、general/provider 設定の入力値がインポート前のまま残る。

## 優先度

- 順位: 02/20
- RICE: 18.0（R6 / I3 / C1.0 / E1.0）
- 根拠: 実検証済みの未接続欠陥 2 件。`reload-general-settings` CustomEvent が 2 箇所で発火されるが src/・entrypoints/ を走査してもリスナーが 1 件も無い。PanelLifecycle.refresh は 6+ 箇所で実装されているが本番で一度も呼ばれていない。設定インポート/復元という頻出フローの直後に必ず発生
- 依存: チェーン先頭。generalSettingsPanel.ts への後続編集（C2 rank05 / C9 rank08 / C6 rank14）が serially 追従するため本 PBI を先に閉じる

## 背景（file:line 現状）

- 発火（リスナーなし・dead event）:
  - `src/dashboard/exportImport.ts:102`: `importCtx.loadGeneralSettings` が `document.dispatchEvent(new CustomEvent('reload-general-settings'))`
  - `src/dashboard/encryptedBackupPanel.ts:114`: 復元完了時に同じ CustomEvent を発火
  - src/・entrypoints/ の grep で `addEventListener('reload-general-settings')` は **ゼロ件**
- refresh が未接続:
  - `src/dashboard/panels/staticForm/generalSettingsPanel.ts:374-381`（他 staticForm パネル・`staticPanels.ts:57,64,80,88`・`staticPanelAdapter.ts:45-48` の計 6+ 箇所）に `refresh()` 実装があるが
  - `src/dashboard/panels/NavigationRegistry.ts:110,114` は `init/activate` と `load` しか呼ばず、refresh の呼び出しが本番に存在しない
- 実害: インポート後は `importCtx` 直呼び（`exportImport.ts:97-100`）で domain/privacy/content/trust は再読込されるが、general/provider 設定は stale のまま表示される

## BDD受け入れシナリオ

```gherkin
Scenario: 設定インポート後に全般設定パネルが最新化される
  Given 一般設定パネルが表示されている
  When 設定インポートが完了する
  Then generalSettingsPanel の refresh が実行され、provider/全般の入力値がリポジトリ最新値に同期する

Scenario: 暗号化バックアップ復元後も最新化される
  Given 復元が成功した
  When 復元完了ステータスが表示される
  Then refresh が実行され、古い入力値が残らない

Scenario: refresh 失敗がインポート自体を壊さない
  Given refresh が例外を投げる
  When インポート完了処理が走る
  Then エラーはログに記録され、インポートの成功ステータスと発火元フローは壊れない

Scenario: dead event の掃除
  Given refresh 直接呼び出しで代替する裁定が下された
  When コードベースを確認する
  Then 未接続の `reload-general-settings` 発火が残らない
```

## 受け入れ基準

- [ ] リスナー配線（パネル構成側で `reload-general-settings` を受信して refresh を呼ぶ）または直接呼び出しのいずれかの方式が裁定され、理由が 1 行残されている
- [ ] 設定インポート後（`src/dashboard/exportImport.ts:102` 経由）に `src/dashboard/panels/staticForm/generalSettingsPanel.ts:374-381` の refresh が実行される
- [ ] 復元後（`src/dashboard/encryptedBackupPanel.ts:114` 経由）も同様に refresh が実行される
- [ ] refresh 呼び出しは catch で保護され、失敗時もインポート/復元の完了ステータスが壊れない
- [ ] 採用方式で不要になった dead event 発火が `src/`・`entrypoints/` の grep で残らない
- [ ] refresh の単体テストが追加される（実時間待ちなし）
- [ ] 後続の generalSettingsPanel.ts 編集 PBI（rank05 / rank08 / rank14）が本 PBI の後に serially 実施される旨が明記されている

## テスト戦略

- 単体: ダミー document/dispatchEvent で発火 → リスナー（または直接呼び出し経路）が refresh を呼ぶことを pin
- 単体: refresh が throw しても上位フローが継続することを pin
- 実時間待ち・固定 sleep は使わない。既存テスト green 維持 + `npm run validate` 通過

## 見積もり

2.0 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了
