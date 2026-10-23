# PBI: 通知方針のtable化とmock削減

## ユーザーストーリー

保守担当者として、通知の知識をtable 1箇所に集めたい。なぜなら文面・ボタン変更がmethod追加＋8箇所のmock更新になり、seam維持費だけが発生しているから。

## 優先度

- 順位: 02 / 全8件
- RICE スコア: 10（Reach = 10 / Impact = 1 / Confidence = 1.0 / Effort = 1.0人日）
- 根拠: mock 8箇所の削減で検証が軽くなる。interfaceとimplementationが1:1のshallowさが確定。

## ビジネス価値

通知文言・ボタン変更がtable 1箇所の編集になり、不具合の検証点が1箇所に集約される。

## BDD受け入れシナリオ

```gherkin
Scenario: 通知がtable駆動で出る
  Given 通知条件がある
  When 通知する
  Then 変更前と同一の文面・ボタンで出る

Scenario: 文言変更が1箇所で済む
  Given 文言を変えたい
  When tableを変える
  Then 全呼び側に反映され、mock更新が不要になる
```

## 受け入れ基準

- [ ] 通知方針（文面・ボタン構成・requireInteraction方針）がtableに集まる
- [ ] 8箇所のmockが削減される（tableのunit testに集約）
- [ ] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- 呼び側の通知フローテスト維持

### 単体テスト
- 方針tableのtableテスト新規

## 実装アプローチ

- **Outside-In**: table駆動の失敗テストを先に書き、赤を確認してから寄せる

## 見積もり

1pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 非機能要件: 通知の文面・振舞い不変（`badgePolicy.ts:37-61` のtable流儀を参照）

## 変更点の概要

通知知識を方針tableに深めるか、純粋table＋単一write点に寄せてHelperを削除する。

## 現状と問題（file:line 付き）

- `src/background/notificationHelper.ts:8-53` ― static 3 method＋定数1件（全54行）
- 呼び側5箇所（checkTrustDomainStep・saveToObsidianStep・resultBuilder・recordingHandlers・entryFrictionHandlers）
- mock 8箇所（RecordingPipeline.test・resultBuilder.test・checkTrustDomainStep.test・recordingPipeline-impl.test ほか）

## 変更の理由（depth）

depthがほぼないのにseam維持費だけが発生。深めるか消すかの二択。

## 提案コード（骨子のみ）

```typescript
// 案A: 通知方針table＋単一seam。案B: 純粋table＋単一write点に寄せて削除。
// いずれも呼び側の学びはtable 1箇所。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -rn "NotificationHelper" src/ --include='*.ts' | grep -v __tests__ | head; grep -rln "NotificationHelper" src/ --include='*.test.ts'
```

### 落とし穴

- 通知文面を1文字も変えない（既存テストが緑のまま移設されること）
- mock削除はtableテストの緑を確認してから行う

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過 + tableテスト新規通過
- [ ] コードレビュー完了
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み
