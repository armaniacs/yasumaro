# PBI: tabs 権限なしで参照される tab.url の制約を裁定し文書化する

## ユーザーストーリー

拡張機能の保守担当者として、badge 更新と nav trail がなぜホスト権限のないサイトで動かないかが文書化されていてほしい。tabs 権限なしで tab.url / changeInfo.url が undefined になり、複数の経路が黙って no-op になるから。

## 優先度

- 順位: 7/17
- RICE: 4.8（R3 / I2 / C0.8 / E1・investigate）
- 根拠: 実機能の構造的無効化（localhost/AI host 以外）。ただし修正選択肢が manifest 権限変更（高リスク領域・install ダイアログの権限文言が変わる）を含むため investigate として裁定を先に確定する
- 依存: なし。裁定後の実装 fix は後続 PBI（台帳管理）

## 背景（file:line 現状）

- manifest: `wxt.config.ts:223-235` — permissions に `tabs` なし（storage/activeTab 等）。host_permissions は localhost + AI provider ドメインのみ
- 生参照: `src/background/handlers/tabEventHandlers.ts:42-44,52,70-75`（`tab.url` → バッジ更新が URL 読めないと early return）/ `src/background/service-worker.ts:257-259,268-279`（`changeInfo.url` → nav trail が通常サイトで未作成）
- nav trail の唯一の writer: `src/background/navTrail/navTrailTracker.ts:69-93`（`onTabUrlChanged`）
- 制約の文書化済み例: `src/background/regenerateContentFetcher.ts:11-13`（「manifest has no tabs permission…」）
- .kilorules #5: 「tab.url / tab.title には tabs 権限が必要。無いとエラー無しで undefined が返る」

## BDD受け入れシナリオ

```gherkin
Scenario: 裁定が ADR として記録される
  Given manifest 権限変更と payload 由来再配線の 2 選択肢がある
  When 裁定を実施する
  Then 選択理由・却下理由・影響（install ダイアログの権限文言等）が ADR に記録される

Scenario: 黙って no-op になる経路に根拠コメントが付く
  Given tabEventHandlers / service-worker の tab.url 参照
  When 裁定後にコードを確認する
  Then regenerate 経路と同等の根拠コメントが参照箇所に付く
```

## 受け入れ基準

- [ ] 選択肢を比較した ADR を `dev-docs/ADR/` に作成（manifest 変更の影響: install ダイアログ文言・host_permissions 最小化 ADR との整合・privacy posture）
- [ ] 裁定に応じて実装 fix の後続 PBI を起票する（manifest 追加 or VALID_VISIT payload 由来の再配線 + 語義変化の pin）
- [ ] 裁定が manifest 変更でない場合、tab.url 参照箇所に制約の根拠コメントを追加
- [ ] 記録: 誰が読み書きするか・どの経路が no-op かの一覧を ADR に残す
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- investigate: コード調査 + ADR 作成。挙動変更は行わない（後続 fix PBI が fixture pin 付きで実施）
- 配置: 実装 fix は起票時に決める

## 見積もり

1 SP（investigation 部分）

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] 後続 fix PBI が pbi/ に起票されている（manifest 変更を選んだ場合も同様）
