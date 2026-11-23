# PBI popup・dashboardのi18n漏れと信頼性向上

## ユーザーストーリー

英語利用者として、表示文言が言語設定に沿って表示され、長時間処理の状態が正しく分かってほしい、なぜなら母語外の文言や誤タイムアウトは操作の迷いにつながるから。

## 優先度

順位 14/17。RICE 30 (Reach=150 / Impact=0.5 / Confidence=80% / Effort=2人日)。根拠: 表示品質中心。

## 対象の指摘

検証済み9件。実装詳細は書かない。対処方針は受け入れ基準とBDDに従う。

1. src/popup/statusChecker.ts:61-75 ― getMessageOrフォールバックが日本語直書き。
2. src/popup/recordCurrentPage/previewFlow.ts:112,120 ― 英語直書きエラー文が素通し表示。
3. src/popup/recordCurrentPage/recordSession.ts:479,486,610 ― 英語生エラー文が表示経路に乗る。
4. src/popup/errorUtils.ts:76,196-199 ― ' at '等を含む行を全削除し正規英文がUNKNOWN扱いで情報喪失。
5. src/popup/statusChecker.ts:124 ― 特殊URL判定が3種のみでfile/data系に無駄なSW往復。
6. src/dashboard/panels/NavigationRegistry.ts:127-135 ― load失敗表示に生errorMessageをtextContentしi18nなし。
7. src/dashboard/aiTestProgressClient.ts:66-79 ― timeoutがsubscribe時一発で進捗毎リセットなし。長時間テストで誤タイムアウト。
8. src/dashboard/settings/ublockImport/fileReader.ts:11-27 ― サイズ上限・中断処理なし。大容量でUIフリーズ。
9. src/dashboard/notificationService.ts:2-8 ― 通知createの権限/エラーを無視。不許可環境で無音失敗。

## BDD受け入れシナリオ

### シナリオ1: 通常表示・操作は従来通り (ハッピーパス)

- Given 日本語または英語の言語設定でpopupとdashboardを開いている
- When 通常の表示と操作を行う
- Then 従来通りの文言と画面遷移になり、回帰なく操作できる

### シナリオ2: 英語環境で日本語フォールバックが表示されない (エラー/境界)

- Given 言語設定が英語の環境
- When ステータス確認、プレビュー、記録、設定読み込み失敗など表示経路を通る処理を実行する
- Then 日本語直書きフォールバックや生エラー文は表示されず、言語設定に沿った文言になる

### シナリオ3: 長時間テストが進行中はタイムアウト表示にならない (エラー/境界)

- Given AIテスト実行などで長時間の進捗が続く状態
- When 進捗通知が継続している間に経過時間を監視する
- Then 進行中にもかかわらず誤ってタイムアウト表示に切り替わらない

### シナリオ4: 大容量ファイル投入でUIが固まらない (エラー/境界)

- Given uBlock取り込み画面を開いている
- When 大容量のファイルを投入する
- Then UIが固まらず、中断や上限の扱いが言語設定に沿って分かる

## 受け入れ基準

- 上記9件の各指摘に対処していること。
- 英語環境で日本語フォールバック表示が残っていないこと。
- 長時間テストの進行中に誤タイムアウト表示が出ないこと。
- 大容量ファイル投入時にUIが固まらないこと。
- 通知権限なし環境での無音失敗がないこと。
- 既存の回帰テストが緑であること。

## テスト戦略

- 単体テスト: ロケール切り替え時の表示文言、境界値(サイズ上限、特殊URL、権限なし、進捗継続中タイムアウト)。
- 回帰テスト: popupとdashboardの既存表示・操作フロー。
- i18n検査で未対応文言がないことを確認する。

## 見積もり

- M

## Definition of Done

- 全BDDシナリオが自動テスト化されていること。
- コードレビューが完了していること。
- i18n検査が緑であること。

## 出典

- adversarial-code-review 2026-11-08。
