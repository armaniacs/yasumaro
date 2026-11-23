# PBI 訪問ゲーティング・滞在判定の正確性修正

## ユーザーストーリー

記録利用者として、滞在時間とスクロール到達の判定が正しい状態で記録されてほしい。なぜなら誤判定は記録漏れや誤記録として履歴の信頼性を壊すから。

## 優先度

- 順位: 02/17
- RICE: 240 (Reach=300 / Impact=2 / Confidence=80% / Effort=2人日)
- 根拠: 全利用者の記録正確性に直結するため。

## BDD受け入れシナリオ

### シナリオ1: ハッピーパス - SPA遷移後に新しい滞在基準で判定される

- Given: 記事ページで滞在計測が開始している
- When: SPA遷移で別ページに移動する
- Then: 新しいページの滞在基準で滞在時間とスクロール到達が判定される
- Then: 遷移前の古い開始時刻としきい値は使われない

### シナリオ2: 境界値 - 範囲外のしきい値は安全に扱われる

- Given: 滞在しきい値に範囲外の値(0、負数、巨大値)が渡される
- When: 訪問ゲーティングの判定が行われる
- Then: しきい値はclampされるか、拒否されて安全側の既定値になる
- Then: 0や負数で即時発火しないし、巨大値で永久に発火しない状態にならない

### シナリオ3: 異常系 - innerHeight異常時は安全側に倒れる

- Given: window.innerHeightが異常値(NaN、0、未定義相当)になっている
- When: スクロール到達の判定が行われる
- Then: 判定は黙って現状維持にならない
- Then: 安全側の扱いに倒れ、回復可能な状態になる

### シナリオ4: 異常系 - performance不在でも記録が止まらない

- Given: performanceが不在の実行環境である
- When: スクロールイベントが発生する
- Then: 初回呼び出しで例外により処理が止まらない
- Then: 深度の更新と滞在記録が継続される

## 受け入れ基準

- [x] 指摘(1)の状態が解消されること。SPA遷移時に開始時刻としきい値が新しいページの基準になること
- [x] 指摘(2)の状態が解消されること。mediaKind遷移やoverride単独変更が見落とされないこと
- [x] 指摘(3)の状態が解消されること。parseInt後の範囲外値が安全に扱われること
- [x] 指摘(4)の状態が解消されること。innerHeight異常時に黙って現状維持にならないこと
- [x] 指摘(5)の状態が解消されること。performance不在環境でも深度更新が継続すること
- [x] 指摘(6)の状態が解消されること。無効context判定が文言変更に左右されないこと
- [x] 上記の回帰テストが追加され、全て通過すること

## 対象の指摘(検証済み6件)

- (1) src/content/extractor.ts:36 - PageStateはimport時に一度だけ生成でpushState購読なし。SPA遷移でstartTime・thresholdsが旧いまま
- (2) src/content/visitGating.ts:91-97 - staleness比較がminDuration/minScroll/startTimeのみでmediaKind遷移やoverride単独変更を検知しない
- (3) src/content/visitGating.ts:182-189 - parseInt後の範囲検証なし。0/負数で即時発火、巨大値で永久不発
- (4) src/content/scrollMonitor.ts:52-58/:15-19 - window.innerHeight無検証でNaN混入時は比較が全てfalseになり黙って現状維持。回復手段なし
- (5) src/content/throttle.ts:48,63 - 素のperformance.now()無ガード。不在環境で初回scroll呼がthrowし以後深度が更新されない
- (6) src/content/visitReporter.ts:287-297 - 無効context判定が文字列includesのみ。文言変更で即時離脱ではなくretry側に落ちる

## テスト戦略

- 単体テスト中心とする
- 境界値テスト: しきい値の0、負数、巨大値、小数、非数値
- 異常値テスト: innerHeightのNaN/0/未定義、performance不在、無効context
- SPA遷移模擬: pushState相当の遷移で開始時刻としきい値が更新されることを確認する
- 既存の訪問ゲーティング関連テストを回帰実行する

## 見積もり

- M (2人日想定)

## Definition of Done

- 全BDDシナリオが自動テスト化されていること
- 新規の回帰テストが全て通過すること
- コードレビューが完了していること
- 他ファイルへの不要な変更がないこと

## 出典

- adversarial-code-review 2026-11-08
