# PBI: Recording handlerの共通interfaceを深深化する

## 実装状況

**完了** — 2026-08-11。recording handlerの最小dependency interface、共有closure、composition wiringを実装済み。

## 親PBI

`2026-08-11-01-architecture-deepening-epic.md`

## ユーザーストーリー

開発者として、記録系handlerに重複したdependency interfaceを持たせず、Recording moduleの必要な振る舞いだけを一つのseam越しに提供したい。これにより、composition rootの配線を局所化し、handlerのtestabilityと変更時のleverageを高めたい。

## スコープ

- `ManualRecordHandlerDeps`と`SaveRecordHandlerDeps`の重複を解消する。
- 記録系handlerが必要な振る舞いだけに依存する構造へ整理する。
- `setUrlContent`など重複したclosure配線を一箇所へ集約する。
- `MessageHandlerRegistryDeps`の依存知識を必要最小限に整理する。
- 既存のhandler registryとcomposition rootの責務を維持する。
- RecordingPipeline / RecordingLogicの既存挙動を維持する。

## 非スコープ

- handler registry全体の再設計
- RecordingPipelineの処理順序変更
- recording permissionやrate limit仕様変更
- Service Worker lifecycle変更
- AI providerやstorage adapter変更
- 全handlerを一つのinterfaceへ強制統合すること

## 依存関係

子PBI 3完了後に開始し、子PBI 5に先行して完了する。

## 受け入れ条件

```gherkin
Scenario: 手動記録handlerが必要な振る舞いだけを利用する
  Given 手動記録handlerが登録されている
  When 手動記録messageを処理する
  Then handlerは記録に必要なRecording moduleのinterfaceだけを利用する
  And RecordingLogic全体や不要なmethod群へ依存しない
  And 既存の手動記録結果が維持される

Scenario: 保存handlerが共通interfaceを利用する
  Given 保存handlerが登録されている
  When 保存messageを処理する
  Then 保存handlerは手動記録handlerと共有可能なRecording moduleのinterfaceを利用する
  And 重複したdependency interfaceを要求しない
  And 既存の保存処理とエラー応答が維持される

Scenario: composition rootの重複配線を排除する
  Given production composition rootがhandler registryを構築する
  When 記録系handlerを登録する
  Then 共通の依存closureまたはadapterは一度だけ構築される
  And handlerごとの重複配線が存在しない
  And handler固有の依存は明示的に保持される

Scenario: handler間の依存分離を維持する
  Given あるhandlerに新しい依存が追加される
  When handler registryの型を検証する
  Then 不要なhandlerのinterfaceは変更されない
  And 依存追加の影響範囲が対象handlerとcomposition rootに限定される

Scenario: fakeを使ってhandlerをテストする
  Given Recording moduleのfake interfaceがある
  When 手動記録または保存handlerをテストする
  Then 実際のRecordingLogic全体を構築せずにhandlerを検証できる
  And message入力、permission、rate limit、結果変換を確認できる
```

## テスト観点

- 手動記録handlerと保存handlerのinterface越しテスト
- 共通fakeの再利用
- 不要な依存を要求しない型構造
- composition rootのclosure重複防止
- handler固有依存の分離
- permission拒否、rate limit拒否、recording failure
- success / error response mapping
- MV3非同期message応答と`return true`
- registry構築時の既存handler登録

## 完了条件

- 記録系handlerのdependency interfaceが重複していない。
- handlerは必要な振る舞いだけを依存する。
- composition rootの重複配線が削減されている。
- handlerテストがRecordingLogic全体の構築に依存しない。
- handler registryの既存動作とMV3 message契約が維持される。
- ADRの明示的な依存注入方針と整合する。
- 子PBI 5が利用できる安定したcomposition rootと依存注入経路が確立される。

## 実装結果

- `RecordingHandlerBaseDeps`へ共通依存を集約した。
- 未使用のstorage、AI、Obsidian依存をhandler interfaceから削除した。
- `setUrlContent` closureをcomposition rootで一度だけ構築した。
- MV3 message契約、permission、rate limit、RecordingPipeline共有を維持した。
- 関連テスト、type-check、validate、buildが成功した。
