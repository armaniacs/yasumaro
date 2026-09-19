# PBI: Test Connection を保存構成と同一判定にする（host エンドツーエンド配線）

## ユーザーストーリー
拡張機能利用者として、保存前に Test Connection で入力中の構成を検証したい、なぜなら保存できるはずの構成が接続テストで再現できないと、保存時ブロック（http＋非loopback）の意味が半減するから

## 優先度
- 順位: 22 / 全候補3件中1位
- RICEスコア: 48（Reach=20 / Impact=2 / Confidence=80% / Effort=0.67）
- 根拠: 3件中唯一の機能未達（PBI 15 の受理基準の残部）＋セキュリティ境界の整合。工数小

## ビジネス価値
Test Connection がフォーム値（protocol/port/host）をそのまま評価し、保存ゲートと同一の loopback ルールで判定する。測定は「フォームで http＋LANホスト → Test Connection が失敗を表示」

## BDD受け入れシナリオ

```gherkin
Scenario: フォームの http＋LANホストは Test Connection で失敗する
  Given フォームに protocol=http、host=192.168.1.10、APIキーあり
  When Test Connection を実行する
  Then 非 loopback HTTP として失敗が表示される
  And 保存は実行されない

Scenario: 全フィールド空なら保存済み設定でテストする
  Given フォームの全フィールドが空
  When Test Connection を実行する
  Then 保存済み設定でテストする（従来動作）
```

## 受け入れ基準
- [x] TestObsidianMessage の payload 型に protocol/port/host を追加
- [x] createTestObsidianHandler が空でないフォーム値を override に転送する（空のみなら従来通り stored 設定。空白のみも除外）
- [x] ObsidianClient.testConnection と TestObsidianHandlerDeps のシグネチャに host を追加
- [x] connectionTests.ts が #obsidianHost の値を payload に載せる（空は省略）
- [x] handler テストを新設（転送・空値除外・全空 stored 経路・応答形状の5 tests）＋connectionTests 既存2テストを新契約に更新
- [x] senderTrustCoverage.test.ts が green のまま（extension-only 維持を確認済み。再調査で trust 不整合の疑いは誤りと判明）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 設定画面で http＋LANホストの Test Connection が失敗表示になる

### 統合テスト
- handler → testConnection → buildFromOverride の転送経路

### 単体テスト
- override 組み立ての空値フィルタ境界

## 実装アプローチ
- **Outside-In**: handler 転送のテストから開始
- **Red-Green-Refactor**: 既存 apiKey 経路を壊さず拡張

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: PBI 06・15（loopback ルールと保存ゲート）が前提
- テスタビリティ: handler は純粋な転送ロジック
- 非機能要件: trust level は extension-only のまま変更しない（VULN-009 維持）

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "TestObsidianMessage" src/background/messageTypes.ts
grep -n "createTestObsidianHandler" -A 12 src/background/handlers/testingHandlers.ts
grep -n "testObsidianConnection" -A 15 src/dashboard/generalSettings/connectionTests.ts
```

### 実装手順
1. messageTypes.ts の payload 型を拡張
2. handler の override 組み立てを拡張（空値フィルタ）
3. testConnection・Deps のシグネチャに host を追加
4. connectionTests.ts に host を追加
5. handler テストを拡張

### 落とし穴
- trust level を緩めてはいけない。TEST_OBSIDIAN は extension-only（CONTENT_SCRIPT_ALLOWED_TYPES は VALID_VISIT/CONTENT_CLEANSING_EXECUTED/CHECK_DOMAIN/PING の4型のみ）。レビュー時に一時疑った trust 不整合は無かった（見ていたリストは VALID_MESSAGE_TYPES）
- port='' を builder に流さないこと。空値は connectionTests/handler の両方でフィルタする

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
