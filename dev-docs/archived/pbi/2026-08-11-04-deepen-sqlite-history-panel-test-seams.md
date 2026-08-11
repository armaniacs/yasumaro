# PBI: SQLite history panelの内部seamを深深化する

## 実装状況

**完了** — 2026-08-11。DOM非依存state seam、request generation guard、unmount後のstale response防止、既存UI回帰テストを実装済み。

## 親PBI

`2026-08-11-01-architecture-deepening-epic.md`

## ユーザーストーリー

開発者として、SQLite history panelのstate、query、render、formattingの判断をテスト可能な内部seamへ整理したい。これにより、外部panel interfaceを維持したまま、DOM依存を減らし、変更のlocalityとtestabilityを高めたい。

## スコープ

- state遷移を内部seamへ整理する。
- query結果から表示用データへの変換を内部seamへ整理する。
- formattingとHTML生成の純粋な判断をDOMから分離する。
- 子PBI 2のunified history query moduleを利用する。
- 外部の`AsyncDataPanel` interfaceを維持する。
- panel lifecycle、検索、pagination、tag filterの既存挙動を維持する。

## 非スコープ

- panel全体のファイル分割
- 新しいpanel abstraction
- UIデザイン変更
- history queryのstorage adapter変更
- SQLite schema変更
- 他のdashboard panelへの一括適用

## 依存関係

子PBI 2完了後に開始し、子PBI 4に先行して完了する。

## 受け入れ条件

```gherkin
Scenario: panel lifecycleを維持する
  Given SQLite history panelがdashboardへ登録されている
  When mount、loadData、onActivate、unmountが実行される
  Then 既存のlifecycle順序が維持される
  And query結果はpanelの表示へ反映される
  And unmount後にevent listenerやpending処理が残らない

Scenario: state遷移をDOMなしで検証する
  Given 初期stateのSQLite history panelがある
  When 検索、pagination、tag filterの操作を適用する
  Then state遷移が定義された規則に従う
  And stateのテストはDOM環境を必要としない
  And 不正なページ番号や空のfilterが安全に処理される

Scenario: query結果を表示用データへ変換する
  Given unified history query moduleが履歴行を返す
  When panelが表示用データを生成する
  Then field formattingと欠損値処理が既存仕様に従う
  And query結果のschemaがDOMへ直接漏れない

Scenario: 診断metadataを安全に表示する
  Given 履歴行に診断metadataまたは不正な文字列が含まれる
  When panelがdiagnostic metadataをHTMLへ変換する
  Then 既存のsanitization規則が適用される
  And HTML injectionが発生しない
  And 有効なmetadataは従来通り表示される

Scenario: query失敗をpanelへ伝える
  Given unified history query moduleが失敗結果を返す
  When panelが履歴を読み込む
  Then panelは既存のエラー表示を行う
  And 失敗を空の履歴として扱わない
  And loading stateが終了する
```

## テスト観点

- state reducer相当の内部seam、表示用変換、formatting、欠損値
- diagnostic metadata sanitizationとXSS相当入力
- query失敗、空結果、部分metadata
- pagination境界、tag filterと検索の組み合わせ
- lifecycleのlistener cleanup
- DOM統合と`AsyncDataPanel` interface越しのdashboard統合

## 完了条件

- 外部の`AsyncDataPanel` interfaceが維持される。
- state、query、renderの判断を個別にテストできる。
- テストが不要にpanel closure全体やDOMへ依存しない。
- HTML生成時のsanitizationと既存のセキュリティ制約が維持される。
- 子PBI 2のquery interfaceを直接迂回しない。
- ADRのpanel lifecycle方針と整合する。

## 実装結果

- `sqliteHistoryPanelState.ts`へstate遷移と純関数テストを追加した。
- queryの世代管理とunmount無効化を追加した。
- 不正pageのclamp、query failure、sanitizationの契約をテストで固定した。
- `AsyncDataPanel` interfaceと既存UI lifecycleを維持した。
- 関連テスト、type-check、validate、buildが成功した。
