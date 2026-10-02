# PBI: collector throw 意味論 (swallow vs propagate) を復元または成文化する

種別: fix (C2, RICE #7)

## ユーザーストーリー

設定パイプラインの失敗を見逃さず診断したい保守担当者として、collector の throw が握りつぶされるのか伝播するのかを明確にしてほしい。沈黙の空返却は障害の見逃しに直結するから。

## 背景

`collectASafe` の throw 経路の意味論が曖昧である。pipeline 側で catch して伝播させるのか、collector 側で swallow して空返却するのか、現状のいずれかが意図的か回帰かの裁定が必要。

## スコープ (file:line)

- `src/dashboard/panels/asyncData/providerPrioritySlots.ts:58-63` (collectASafe)
- `src/dashboard/settingsPipeline.ts:142`
- `src/dashboard/panels/staticForm/generalSettingsPanel.ts:212-221`

## BDD 受け入れシナリオ

```gherkin
Scenario: throw が伝播する場合
  Given collectASafe が例外を投げる
  When settingsPipeline 経由で収集される
  Then pipeline の catch で捕捉され、呼び出し側が失敗を検知できる

Scenario: swallow が意図的な場合
  Given collectASafe が例外を投げる
  When swallow が仕様として成文化される
  Then 空返却になることがテストで pin され、沈黙の握りつぶしではないことが明示される
```

## 受け入れ基準 (file-scoped)

- [ ] restore-or-codify の裁定が実施されている (propagate + pipeline catch への復元、または codified swallow のいずれか)
- [ ] propagate を選んだ場合: `src/dashboard/settingsPipeline.ts:142` の catch 経路で失敗が捕捉・伝播することが実装されている
- [ ] codified swallow を選んだ場合: `src/dashboard/panels/asyncData/providerPrioritySlots.ts:58-63` の silent-empty ケースを pin するテストが存在し、仕様コメントがコードに残っている
- [ ] `src/dashboard/panels/staticForm/generalSettingsPanel.ts:212-221` が裁定後の意味論と整合している
- [ ] throw パスの parity テスト (propagate / swallow のいずれの分岐もカバー) が追加されている

## テスト戦略

- 単体: collectASafe に例外を注入し、propagate または codified-swallow のいずれかが pin されるテスト
- 単体: settingsPipeline.ts:142 の catch 経路テスト
- 単体: generalSettingsPanel.ts:212-221 の整合テスト
- 既存テスト green 維持 + `npm run validate` が通ること

## 振る舞い変更ルール (fix)

- 意味論の変更は本 PBI の裁定 1 点のみに限定する (収集対象・優先順位ロジックの変更は別 PBI)
- swallow を残す場合は理由付き英語コメント + テスト pin を必須とし、空 catch 化しない
- propagate に戻す場合は呼び出し側への影響 (UI 表示・ログ) をドキュメント化する

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了
