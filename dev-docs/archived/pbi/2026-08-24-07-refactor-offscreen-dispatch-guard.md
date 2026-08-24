# PBI: Offscreen dispatch に共通 payload guard を抽出し shallow switch を deep module 化

## ユーザーストーリー
開発者として、SQLite メッセージdispatch時の payload size guard を一箇所に集中化したい。なぜなら 24 ケースの switch が個別に guard を再実装しており、セキュリティ cross-cutting が dispatch に散在しているから。

## 優先度
- 順位: 02 / 全候補数 7
- RICEスコア: 48.0（Reach=24 / Impact=3 / Confidence=100% / Effort=1.5人週）
- 根拠: 24 message types が対象。RICE 最高。セキュリティ cross-cutting（payload size guard）の集約は全 SQLite 操作に影響。

## BDD受け入れシナリオ

Scenario: 新規メッセージタイプが guard を自動継承する
  Given `dispatchSqliteMessage` に 24 ケースの switch が存在する
  And 各ケースが個別に `summary.length` / `records.length` / `rawData.length` をチェックしている
  When `sqliteMessageHandlers: Map<type, Handler>` + 共通 `assertPayloadSize` guard に置換する
  Then 新規 `SQLITE_FOO` を追加する際、guard を再実装する必要がない
  And guard 違反時に一貫したエラーが返される

Scenario: statusPanel が独立モジュールに分解される
  Given `statusPanel.ts` が 444 行の shallow coordinator である
  When TrustBadge / PermissionBanner / CleansingBadge に分解する
  Then 各モジュールが単一の concern を持つ
  And `main.ts` が各モジュールを独立して初期化できる

## 受け入れ基準
- [ ] `dispatchSqliteMessage` の 24-case switch が `Map<type, Handler>` に置換されている
- [ ] 共通 `assertPayloadSize` guard が全 handler に適用されている
- [ ] `buildRecordFromPayload` が pure function として抽出されている
- [ ] `statusPanel.ts` が TrustBadge / PermissionBanner / CleansingBadge に分解されている
- [ ] 既存の SQLite 操作テストが全てパスする
- [ ] `npm run test` が PASS する

## テスト戦略
- **統合**: 全 24 message types の送受信が既存テストで検証されていることを確認
- **単体**: `assertPayloadSize` の境界値テスト（0, 1MB, 1MB+1byte）
- **単体**: 各 Handler の pure function テスト

## 見積もり
1.5 ストーリーポイント（中 — 1.5 人週程度）

## 技術的考慮事項
- **依存**: なし
- **テスタビリティ**: Handler を pure function + 副作用分離にすることで、テストが DOM/offscreen 環境を不要にする
- **非機能要件**: セキュリティ cross-cutting の集約により、新規 guard 追加の抜け漏れを防止

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "dispatchSqliteMessage" src/offscreen/offscreen.ts
grep -n "summary.length" src/offscreen/offscreen.ts
grep -n "MAX_BATCH" src/offscreen/offscreen.ts
```

### 実装手順
1. `src/offscreen/sqliteMessageHandlers.ts` を新設し `Map<SqliteMessageType, Handler>` を定義
2. 各 case の pure 処理（`buildRecordFromPayload`, `recordsRepo` 操作）を Handler に抽出
3. 共通 `assertPayloadSize(msg, limits)` を新設し各 Handler の先頭で呼び出す
4. `dispatchSqliteMessage` は handler 解決 + guard 呼び出し + エラー分類のみを行う
5. `statusPanel.ts` を TrustBadge / PermissionBanner / CleansingBadge に分解
6. テストを新しい構造に移行

### 落とし穴
- `AuthorizedSqliteSender` brand は dispatch 内で `_authorized` として受け取るが未使用。brand の意図（sendResponse 権限）を確認し、必要なら handler 内で検証する。
- `SQLITE_UPDATE` の title guard と `SQLITE_INSERT` の content guard が不一致。統一する。

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
