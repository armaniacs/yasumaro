# PBI: Backgroundの依存配線をcomposition moduleへ集約する

## 種別
refactor / 既存実装の改善

## ユーザーストーリー
開発者として、backgroundの手動記録とメッセージ経路が同じ依存配線を使ってほしい。なぜなら、一方だけの修正による動作ドリフトを防ぎ、配線を1箇所でテストしたいから。

## 調査結果
`createBackgroundServices`、`service-worker.ts`、`messageHandlers.ts`、`recordingLogic.ts` を検索した。本PBIは本番未使用または重複している既存配線を整理する改善である。

対象:
- `src/background/service-worker.ts`
- `src/background/createBackgroundServices.ts`
- `src/background/recordingLogic.ts`
- `src/background/handlers/messageHandlers.ts`
- manual record / context menu / recording pipeline関連テスト

## 5 Whys
1. なぜmanual recordとcontext menuで差異が生じうるのか。同じ依存集合を別々に組み立てているから。
2. なぜ別々に組み立てるのか。service-workerがcomposition moduleを本番で使わず、handlerが自分でpipelineを生成するから。
3. なぜ本番で使われないのか。導入時にテスト用の配線だけを先に作り、本番entrypointの切替を完了していないから。
4. なぜ切替漏れが検出されないのか。productionのcomposition経路を通る統合テストが不足しているから。
5. なぜテストが不足するのか。依存配線がmoduleとして独立したtest surfaceになっていないから。

根本原因: backgroundのseamがservice-worker、handler、pipeline生成へ分散し、配線の責務が局所化されていない。

## BDD受け入れシナリオ

```gherkin
Scenario: 手動記録とコンテキストメニュー記録が同じ配線で動く
  Given background servicesが初期化済みである
  When 利用者が手動記録またはコンテキストメニュー記録を開始する
  Then 両経路は同じrecording依存を利用する
  And 記録結果の挙動が一致する

Scenario: 依存の設定を変更すると全経路へ反映される
  Given recording pipelineの依存設定が変更される
  When message経路とcontext menu経路を実行する
  Then 両経路が同じ設定を利用する
  And 片方だけ古い配線を使わない

Scenario: 初期化失敗が安全に扱われる
  Given 必須のbackground依存の初期化に失敗する
  When service-workerが起動する
  Then 記録開始は失敗結果を返す
  And 未初期化の依存を使って処理を続行しない
```

## 受け入れ基準
- [ ] 本番のservice-workerがcomposition moduleを利用する。
- [ ] manual recordとcontext menuの依存配線が複製されない。
- [ ] message handlerやrecordingLogicが毎回同じ依存を再構築しない。
- [ ] AIService統一ADRの方針を維持し、既存例外以外でAIClientへ逆戻りしない。
- [ ] composition moduleの初期化成功・失敗がテストできる。
- [ ] service-workerの既存Chromeイベント登録を壊さない。

## テスト戦略（TDD）

### Outside-In手順
1. manual recordとcontext menuの本番相当統合テストを追加してRedにする。
2. composition moduleから同一依存を返す契約テストを追加する。
3. handlerがcomposition済み依存を受け取るテストを追加する。
4. service-workerの配線をcomposition moduleへ切り替えてGreenにする。
5. 重複配線と未使用生成コードを削除する。

### 統合テスト
- service-worker起動後にmanual recordを実行する。
- context menuイベントからrecording pipelineを実行する。
- message handler経路を実行する。
- 同一mock依存が全経路へ渡ることを確認する。
- 初期化失敗時のエラー伝播を確認する。

### 単体テスト
- composition moduleが必要な依存を1回だけ構築する。
- 作成されたpipelineが同じ依存参照を使う。
- AIServiceの選択と既存例外の扱い。
- optionalな依存が未設定の場合の安全な失敗。

## 実装手順
1. `createBackgroundServices.ts` の返却値と現在のテストを読む。
2. service-worker内の依存生成箇所をすべて検索する。
3. まずproduction相当の統合テストを追加する。
4. composition moduleに不足している生成責務だけを追加する。
5. service-workerのmanual record配線をcomposition module経由に変更する。
6. context menu配線を同じ生成済みmoduleへ接続する。
7. message handlerとrecordingLogicへ毎回渡している依存を整理する。
8. 未使用の旧配線を削除する。
9. service-workerのイベント登録・非同期応答・Chrome MV3制約を確認する。
10. テスト、型チェック、buildを実行する。

## 落とし穴
- Service Workerのグローバル変数に永続状態を保存しない。
- 初期化PromiseをChromeイベントの戻り値として直接返さない。既存の非同期listenerパターンを守る。
- composition moduleを追加しただけで本番配線を切り替えたつもりにしない。
- `reviewSummaryGenerator.ts` のADR上の例外を無理に変更しない。

## 見積もり
3ポイント。PBI-01/02の結果契約変更と競合しやすいため、結果経路の移行後に実施する。

## Definition of Done
- [ ] 本番entrypointがcomposition moduleを通る。
- [ ] 重複配線が削除される。
- [ ] manual record、context menu、message経路の統合テストが成功する。
- [ ] MV3の非同期・状態管理ルールに適合する。
- [ ] `npm run type-check` と `npm run build` が成功する。
- [ ] コードレビューが完了する。
