# PBI: Popupのドメイン分離とchrome DI統一

## ユーザーストーリー
拡張機能の保守担当者として、記録ワークフローの分岐とpayload組立をbackground seamに寄せてほしい、なぜなら仕様変更がUI＋SWの二重編集になり、片側の漏れが送信時失敗になるから

## 優先度
- 順位: 03 / 5
- RICEスコア: 5.3（Reach=5 / Impact=2 / Confidence=0.8 / Effort=1.5）
- 根拠: 毎回の手動記録に波及（R5）し二重編集の解消効果が大きい。境界設計が残るためC0.8。NN01の後（同一ファイル `manualContentFetcher`／`sqliteHistoryModel` に触るためW2で直列）。

## 背景（holistic-code-review テーマ3）
`previewFlow.ts:75-104` の12 field組立と `:137-138` のPII分岐、`recordSession.ts:94` 等のゲート判定、 Whittaker系の政策評価・書込み所有がUI層にある。副作用注入もManual直参照 vs Regenerate全注入で不統一。`resultBuilder.ts:53-61` は純粋宣言と裏腹に通知副作用を同居させている。

## BDD受け入れシナリオ
Scenario: payload組立がbackgroundに寄る
  Given popupから記録intentとtab参照を送る
  When background seamがpayloadを組み立てる
  Then 必須field追加の変更が1箇所で済み、popupの表示制御は変わらない

Scenario: PII分岐がseam経由になる
  Given PII確認要否が設定で変わる
  When 記録を開始する
  Then MANUAL直送 vs PREVIEW→確認→SAVEの分岐結果が従来と同一になる

Scenario: fetcherがテスト可能になる
  Given tab操作のportsを注入する
  When 単体テストでインメモリportsを渡す
  Then chromeモックなしで `manualContentFetcher` がテストできる

## 受け入れ基準
- [x] `buildRecordPayload` がbackground所有ではく中立messaging層（`src/messaging/recordPayload.ts` 新設）に移管され、モックなしで単体テストできる（try/catch・ガードは移設先に同伴不要＝純粋関数のまま移動。`previewFlow` は後方互換の再輸出のみ残し、テストは正典import＋同一参照pinを追加。`RecordPayloadTab` でchrome型結合も除去）
- [x] popupのPII分岐（`previewFlow.ts:137-138`）は `settingsRepository.getAll()` という共有seam経由であることを実測確認。ダイアログ編成自体はUIの責務のため分岐ロジックの移動は行わない（WHY記録。振る舞い不変）
- [x] `isRecordableTab` のUI利用は単一真実源（`recordingGateTable`）の読み取り専用であることを実測確認。SW側が権威ゲートのままなので二重規則ではなく、UI側は表示＋fast-failのみ。コード変更なし（WHY記録）
- [x] `manualContentFetcher.ts` がRegenerate同型のports注入になる（`ManualTabPorts` 新設＋chrome束縛デフォルト。既存の位置引数コンストラクタは維持。新規テスト `manualContentFetcherPorts.test.ts` 2件でchromeなし動作をpin。`compositionManifest` はデフォルト束縛が単一bindingのため変更なし）
- [x] 通知が `recordingOutcome.defaultOutcomeAdapters` 相当へ寄る（`offlineQueueProcessor` の直importを `notifyError` 注入seamに変更。既定は従来と同一関数。新規テストで注入spyをpin。`resultBuilder.ts` の関数自体はoutcome adaptersの既定実装として残る）
- [x] dashboardのstorage直結はseam済みと実測確認（`sqliteHistoryModel` は `setSortPersistenceOverride` 注入、`sqliteHistoryPanel` はdestroy時解除、`debugModeStore` 自体が集中port、`DiagnosticsCollector` は注入fallback付き）。コード変更なし（WHY記録）

## テスト戦略
- E2E: 手動記録（通常／PII確認あり）の表示と結果が変わらないこと
- 統合: popup→backgroundのintent送信テスト
- 単体: 切り出したpayload組立の境界値テスト、fetcherのインメモリportsテスト

## 見積もり
1.5（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate` が通る
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
