# PBI: messageHandlers.ts を責務別に分割する

## ユーザーストーリー
開発者として、`src/background/handlers/messageHandlers.ts`（680行）に6つの無関係な責務グループ（記録・ネットワーク・テスト・ドメイン・キャッシュ/セッション・システム）と13個の薄いパススルーハンドラが混在している状態を解消したい。なぜなら、深い記録ハンドラ（290行）のバグが13個の浅いハンドラと同じファイルに散らばり、31エクスポート（16ファクトリ＋14依存＋1レートリミッタ）という「インターフェース≈実装」の肥大した境界が保守を困難にしているから。

## 優先度
- 順位: 1 / 6
- RICEスコア: 5.33（Reach=10 / Impact=2 / Confidence=80% / Effort=3人日）
- 根拠: レビュー最上位推奨。削除テストで290行の実ロジックが集中する最深モジュール。既存PBIと重複なし。

## ビジネス価値
- 記録ハンドラのバグが1ファイルに集中し、修正・テストが局所化
- テスト/システムハンドラが独立して単体テスト可能に
- エクスポート境界が31→各モジュール約10に縮小
- composition root が3モジュールをimportする形になり、依存注入が明確化

## BDD受け入れシナリオ

```gherkin
Scenario: 分割後も全メッセージが正しくディスパッチされる
  Given messageHandlers が recording/testing/system の3モジュールに分割されている
  When 既存の全メッセージ種別のハンドラが composition root に登録される
  Then 各メッセージが従来と同一のハンドラへディスパッチされる
  And ハンドラ数・信頼レベルが分割前と一致する

Scenario: 各モジュールが自身の依存のみを持つ
  Given recording/testing/system の各モジュールが定義されている
  When 各モジュールのdepsインターフェースを確認する
  Then 記録固有の依存が testing/system モジュールに漏れない
  And テスト/システム依存が recording モジュールに漏れない
```

## 受け入れ基準
- [ ] `recordingHandlers.ts` / `testingHandlers.ts` / `systemHandlers.ts` に分割されている
- [ ] 各モジュールが自身のdepsインターフェースを定義している
- [ ] composition root（`createMessageHandlerRegistry.ts`）が3モジュールをimportしている
- [ ] 31エクスポートが各モジュール約10に縮小されている
- [ ] 既存のハンドラ契約テスト（信頼レベル・送信元検証）がすべてパスする
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 拡張機能の主要フロー（記録・テスト接続・PING）が分割後も動作する

### 統合テスト
- composition root が3モジュールから登録する全メッセージ種別の契約テスト（既存registry契約テストを流用）
- 信頼レベル（sender trust）が分割前後で一致することを固定

### 単体テスト
- 各ハンドラの単体テスト（記録ハンドラのバリデーション・レートリミッタ、テストハンドラの接続結果、システムハンドラのPING/REFRESH等）

## 実装アプローチ
- **Outside-In**: まず composition root の契約テストで全メッセージ登録を固定し、失敗を確認してから分割
- **Red-Green-Refactor**: モジュール抽出ごとにグリーンを保ちながら段階的に移動

## 見積もり
5pt（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（既存PBIと重複しない）
- 副作用: メッセージルーティングの中核。動作変更は許容しない（純粋なファイル分割）
- テスタビリティ: 分割により記録/テスト/システムの各ハンドラが独立してテスト可能になる

## 実装者向け注記

### 現状コードの確認
```bash
# 17ファクトリ＋レートリミッタのエクスポートを確認
grep -n "^export function" src/background/handlers/messageHandlers.ts
# composition root の登録を確認
grep -n "import" src/background/handlers/createMessageHandlerRegistry.ts
```

### 現状（2026-08-17 確認済み）
- `messageHandlers.ts` 680行。ファクトリ17個＋`resetVisitRateLimiter`。`createMessageHandlerRegistry.ts` 110行、`MessageHandlerRegistry.ts` 64行
- 責務グループ: 記録(VALID_VISIT/MANUAL_RECORD/SAVE_RECORD ~290行, 深い) / ネットワーク(FETCH_URL) / テスト(TEST_CONNECTIONS/TEST_OBSIDIAN/TEST_AI) / ドメイン(CHECK_DOMAIN/CONTENT_CLEANSING) / キャッシュ・セッション(GET_PRIVACY_CACHE/ACTIVITY_UPDATE/SESSION_LOCK) / システム(PING/LOG_FORWARD/CONSENT/REFRESH/GENERATE)
- レートリミッタ(`visitRateLimiter`/`VISIT_RATE_LIMIT_MS`/`resetVisitRateLimiter`, 142-177行)は記録グループに属する

### 実装手順
1. composition root の契約テストで全メッセージのハンドラ登録を固定
2. `recordingHandlers.ts` 抽出（VALID_VISIT/MANUAL_RECORD/SAVE_RECORD ＋ レートリミッタ, ~290行）
3. `testingHandlers.ts` 抽出（TEST_CONNECTIONS/TEST_OBSIDIAN/TEST_AI, ~60行）
4. `systemHandlers.ts` 抽出（FETCH_URL/CHECK_DOMAIN/CONTENT_CLEANSING/GET_PRIVACY_CACHE/ACTIVITY_UPDATE/SESSION_LOCK/PING/LOG_FORWARD/CONSENT/REFRESH/GENERATE, ~330行）
5. 各モジュールに専用depsインターフェースを定義
6. `createMessageHandlerRegistry.ts` を3モジュールimportに更新
7. `messageHandlers.ts` を削除（削除テストで記録ロジック290行の集中を確認）

### 落とし穴
- レートリミッタは記録モジュールに属するが、`resetVisitRateLimiter` がテストから直接呼ばれる可能性があるため公開を維持
- 共有されるメッセージ型・定数は既存の共有モジュールに残し、ハンドラ分割の際に移動しない
- depsインターフェース分割時に、記録固有depsがシステムモジュールへ漏れないこと（逆も同様）

## Definition of Done
- [ ] 3モジュール分割が完了し、`messageHandlers.ts` が削除されている
- [ ] 各モジュールが自身のdepsインターフェースを持つ
- [ ] composition root が3モジュールをimportしている
- [ ] 契約テスト（信頼レベル・送信元検証）がパスしている
- [ ] 全テストがパスし `npm run validate` が通過している
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
