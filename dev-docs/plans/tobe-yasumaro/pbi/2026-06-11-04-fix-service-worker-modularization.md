# PBI: Service Worker モジュラー化 — 神モジュール脱却

## ユーザーストーリー
**開発者**として、**service-worker.tsが責任ごとに分割されている**ことを望む、なぜなら**1474行のモノリスはテスト・デバッグ・変更が困難**だから

## ビジネス価値
- 変更影響の局所化（1ファイル変更→1モジュール変更）
- テスト容易性の向上（モック対象の明確化）
- 新規開発者のオンボーディング時間短縮

## BDD受け入れシナリオ

```gherkin
Scenario: HMAC/Base64通知IDロジックが独立モジュールに存在する
  Given service-worker.tsのnotifyNewUrlハンドラ
  When generateSignature/encodeUrlSafeBase64/decodeUrlFromNotificationIdを参照する
  Then これらの関数はhandlers/urlNotificationHandlers.tsに定義されている
  And service-worker.tsからはimportされている

Scenario: レート制限ロジックが独立モジュールに存在する
  Given service-worker.tsのAI要約ハンドラ
  When skipAiRateLimiterのロジックを参照する
  Then RateLimiterクラスがrateLimiter.tsに定義されている
  And service-worker.tsからはインスタンスをimportしている

Scenario: 手動記録用コンテンツ抽出が独立モジュールに存在する
  Given service-worker.tsのMANUAL_RECORDハンドラ
  When manualRecordContentCacheとタブ作成/executeScriptロジックを参照する
  Then ManualContentFetcherクラスがmanualContentFetcher.tsに定義されている
  And service-worker.tsからはインスタンスをimportしている

Scenario: 各モジュールが単体でテスト可能である
  Given urlNotificationHandlers.ts
  When このモジュールの単体テストを実行する
  Then service-worker.tsの依存なしにテストがパスする
  And 同様にrateLimiter.ts, manualContentFetcher.tsもテスト可能
```

## 受け入れ基準
- [ ] `src/background/handlers/urlNotificationHandlers.ts`にHMAC/Base64/通知IDロジックを移管
- [ ] `src/background/rateLimiter.ts`にレート制限ロジックを抽出
- [ ] `src/background/manualContentFetcher.ts`に手動記録コンテンツ抽出を切り出し
- [ ] service-worker.tsから各モジュールをimportして使用
- [ ] 各モジュールの単体テストを作成
- [ ] service-worker.tsが1000行以下に削減される

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 通知URL機能のE2E（既存テストを維持）
- 手動記録機能のE2E（既存テストを維持）

### 統合テスト
- 各モジュールとservice-worker.tsの連携
- メッセージパッシングの整合性

### 単体テスト
- `urlNotificationHandlers.ts`: HMAC生成、Base64エンコード/デコード
- `rateLimiter.ts`: レート制限のしきい値動作
- `manualContentFetcher.ts`: タブ作成、executeScript、キャッシュ

## 実装アプローチ
- **Outside-In**: E2Eテスト（既存）→ 統合テスト（モジュール連携）→ 単体テスト（各モジュール）
- **Red-Green-Refactor**: 既存テストがパスすることを確認→リファクタリング
- **リファクタリング**: 抽出後にservice-worker.tsのサイズ確認

## 見積もり
8 ポイント（中規模）

## 技術的考慮事項
- 依存関係: なし（純粋なリファクタリング）
- テスタビリティ: 各モジュールは独立してテスト可能
- 非機能要件: 性能変化なし（モジュール分割のみ）

## 実装者向け注記

### 現状コードの確認
```bash
# HMAC/Base64ロジックの場所を確認
grep -n "generateSignature\|encodeUrlSafeBase64\|decodeUrlFromNotificationId" src/background/service-worker.ts

# レート制限ロジックの場所を確認
grep -n "skipAiRateLimiter\|rateLimiter" src/background/service-worker.ts

# 手動記録コンテンツ抽出の場所を確認
grep -n "manualRecordContentCache\|executeScript" src/background/service-worker.ts

# 既存のurlNotificationHandlers.tsの内容を確認
cat src/background/handlers/urlNotificationHandlers.ts
```

### 実装手順
1. `urlNotificationHandlers.ts`にHMAC/Base64/通知IDロジックを移管
2. `rateLimiter.ts`にレート制限ロジックを抽出（クラス化）
3. `manualContentFetcher.ts`に手動記録コンテンツ抽出を切り出し（クラス化）
4. service-worker.tsから各モジュールをimportして使用
5. 各モジュールの単体テストを作成
6. service-worker.tsのサイズ確認（1000行以下）

### 落とし穴
- 既存のurlNotificationHandlers.tsに既に一部ロジックがある→統合する
- レート制限はセッションストアに依存している→依存性を注入する設計に
- 手動記録はタブ作成/executeScript/キャッシュの3ステップ→トランザクション的に扱う
- service-worker.tsの型インポート位置が中途半端→全てファイル冒頭に統一

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] service-worker.tsが1000行以下になっている
