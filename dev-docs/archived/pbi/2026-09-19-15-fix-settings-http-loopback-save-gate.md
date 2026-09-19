# PBI: 設定保存時に http＋非loopback の組合せを検証する

## ユーザーストーリー
拡張機能利用者として、保存できる設定は動作してほしい、なぜなら保存時に成功して同期時に失敗する設定は利用者を混乱させるから

## 優先度
- 順位: 02 / 7
- RICEスコア: 40（Reach=20 / Impact=2 / Confidence=80% / Effort=0.8）
- 根拠: 既存 http+LAN 利用者の移行失敗を防ぐ。保存時検証＋Test Connection 一致で縦に閉じる

## ビジネス価値
保存時点でブロックまたは警告され、同期時の突然の失敗がなくなる。測定は保存後の同期失敗報告件数

## BDD受け入れシナリオ

```gherkin
Scenario: http＋LANホストの保存は保存時にブロックされる
  Given プロトコルが http でホストが 192.168.1.10
  When 設定を保存する
  Then 保存が失敗し理由が表示される
  And 同期時の throw は発生しない

Scenario: http＋loopback は保存できる
  Given プロトコルが http でホストが 127.0.0.1
  When 設定を保存する
  Then 保存が成功する

Scenario: Test Connection が保存構成と同じ判定をする
  Given Test Connection で http と非loopbackホストを指定する
  When 接続テストを実行する
  Then 保存時と同じ理由で失敗する
```

## 受け入れ基準
- [x] settingsPipeline.ts の保存経路に http＋非loopback のクロス検証がある（http_non_loopback_blocked で拒否）
- [x] 検証は isLoopbackHost を再利用する（判定の二重化なし）
- [x] ObsidianConfigOverride に host を追加し buildFromOverride で検証される
- [x] エラーメッセージが i18n キー（errorHttpNonLoopback）経由で表示される（ja/en 追加済み）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 設定画面で http＋LANホスト保存がブロックされる

### 統合テスト
- 保存経路と buildFromOverride の判定一致

### 単体テスト
- isLoopbackHost の境界値（既存テストを再利用）

## 実装アプローチ
- **Outside-In**: 保存ブロックのE2Eから開始
- **Red-Green-Refactor**: 検証を1か所に集約

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: PBI 06（2026-09-19-06、非loopback http ブロック）の前提
- テスタビリティ: 判定は既存の純粋関数を再利用
- 非機能要件: 既存 http＋loopback 利用者を壊さない

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "validateProtocol\|protocolWarning" src/dashboard/settings/fieldValidation.ts
grep -n "http_confirm_cancelled\|showConfirmDialog" src/dashboard/settingsPipeline.ts
```

### 実装手順
1. 保存ブロックの統合テストを書く
2. settingsPipeline にクロス検証を追加する
3. ObsidianConfigOverride に host を追加し buildFromOverride に渡す
4. i18n キーを ja/en 両方に追加する

### 落とし穴
- fieldValidation.ts の validateProtocol は単項目検証であり、host を知らない。クロス検証は settingsPipeline 側に置くこと
- 既存の http 確認ダイアログ（http_confirm_cancelled）と二重確認にならないよう統合すること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
