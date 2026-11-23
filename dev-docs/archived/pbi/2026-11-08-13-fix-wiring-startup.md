# PBI 配線・起動順序の可視化と将来破壊の防止

## ユーザーストーリー
開発者として、起動順序やDI配線の暗黙の前提が顕在化されてほしい、なぜなら黙った競合や差し替え不能は将来の変更で起動失敗を招くから。

## 優先度
順位 13/17。RICE 32 (Reach=60 / Impact=1 / Confidence=80% / Effort=1.5人日)。根拠は将来変更の安全性。

## 対象の指摘(検証済み6件)
- (1) wxt.config.ts:22 の prerelease 除去は末尾のハイフン以下だけが対象で、プラス以降の build メタデータが残る。build 付き版で manifest が不正になり得る。
- (2) wxt.config.ts:108-113 の __OW_E2E_PROBE__ は 0 との不一致で判定し既定で有効になる。付け忘れでプローブが生きたまま出荷される。
- (3) src/background/serviceContainer.ts:14-16,25-27 の ServiceKey は string の別名で集合の型検査がない。
- (4) src/background/createBackgroundServices.ts:96-102 は全 entry を無条件に解決し try/catch がない。1サービスの factory 例外が全体を道連れにする。
- (5) src/background/compositionManifest.ts:286-290,305-309 の recordingAdmission は取り込み直後の settingsRepository.getAll() を使い、差し替え時に乖離する。
- (6) entrypoints/background/index.ts:17-23 と service-worker.ts:57-78 の init 一式は完了待ちなしの発火で、完了も順序も観測できない。

## BDD受け入れシナリオ

```gherkin
Scenario: 通常ビルドと起動の成功
  Given リリース用の通常バージョンがある
  When 標準のビルドと起動を行う
  Then 従来通りビルドと起動が成功する

Scenario: build メタデータ付きバージョンの正規化
  Given プラス以降の build メタデータ付きバージョンがある
  When ビルドを行う
  Then manifest のバージョンが正規化される

Scenario: サービス初期化失敗の分離
  Given 一つのサービス初期化が失敗する状態がある
  When 起動処理を行う
  Then 全体停止ではなく検出可能な失敗として扱われる

Scenario: E2E プローブ混入の防止
  Given E2E 用の明示設定がない出荷ビルドがある
  When ビルドを行う
  Then プローブが含まれずに出荷される
```

## 受け入れ基準
- [x] 上記6件の指摘に対処されている
- [x] build メタデータ付きでも manifest が正規化される
- [x] サービス初期化失敗が全体停止にならず検出できる
- [x] E2E プローブの出荷混入が防止される
- [x] 回帰テストが追加され通過する

## テスト戦略
- 単体テストで配線と起動順序の前提を検証する
- ビルド検証で manifest 正規化とプローブ除外を確認する
- 失敗系の単体テストで初期化失敗の分離を確認する

## 見積もり
M

## Definition of Done
- [x] 全BDDシナリオが自動テスト化され通過する
- [x] コードレビューが完了している
- [x] ビルドが成功している

## 出典
adversarial-code-review 2026-11-08。
