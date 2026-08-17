# PBI: エラー分類の統合を完了する（createErrorResponse移行とサニタイズ統一）

## ユーザーストーリー
開発者として、`errorClassification.ts` が統合モジュールとして作成されたのに、合成関数 `createErrorResponse` が非推奨の `errorMessages.ts` に残っており、3つの本番ファイルが非推奨モジュールをimportせざるを得ない状態を解消したい。なぜなら、さらに `errorClassification.sanitizeContext`（キーのみredact）と `sensitiveDataMask.maskSensitiveData`（値の完全redact）という「名前が重複し能力が非重複」な2系統が並立しているから。

## 優先度
- 順位: 2 / 6
- RICEスコア: 4.80（Reach=6 / Impact=2 / Confidence=80% / Effort=2人日）
- 根拠: Strong。レビュー第2推奨。PBI-20/21（エラー分類・機密マスキング統一）の「やり残し」を完了する後続。エラー処理を1モジュールに集約し、全callerが1インターフェースを学習する。

## ビジネス価値
- エラー処理ロジックが3モジュール→1モジュールに集約
- 非推奨wrapper約50行を削除
- サニタイズ（キーredact vs 値redact）が1系統に統一
- callerが1インターフェースを学習するだけで済む

## BDD受け入れシナリオ

```gherkin
Scenario: createErrorResponse が正規モジュールから提供される
  Given errorClassification.ts に createErrorResponse が移行されている
  When 3つの本番importerがエラーレスポンスを生成する
  Then errorClassification.ts から import でき
  And errorMessages.ts は @deprecated な再エクスポートshimのみになる

Scenario: サニタイズが単一系統に統一される
  Given errorClassification.sanitizeContext を使っていた箇所がある
  When sensitiveDataMask.maskSensitiveData に置換する
  Then 値レベルのredactが適用され
  And 置換前後で漏洩防止の強度が後退しない
```

## 受け入れ基準
- [ ] `createErrorResponse` が `errorClassification.ts` に移動している
- [ ] 3本番importer（`messageHandler.ts` / `messageHandlers.ts` / `dashboardSqliteWiring.ts`）が `errorClassification` をimportしている
- [ ] `errorMessages.ts` が @deprecated 再エクスポートshimになっている
- [ ] `sanitizeContext` の利用箇所が `sensitiveDataMask.maskSensitiveData` に置換されている
- [ ] 非推奨wrapper約50行が削除されている
- [ ] 既存の `errorMessages.test.ts` / `logMasker.test.ts` の実質テストが移行されパスする
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- エラー発生時にポップアップ・ダッシュボードへエラーメッセージが従来通り表示される

### 統合テスト
- `createErrorResponse` の契約テスト（エラーオブジェクト→ErrorResponse変換、context付き）
- 3本番importerが正規モジュールから import することを検証

### 単体テスト
- `sanitizeContext`→`maskSensitiveData` 置換後のredact対象・強度の一致
- 非推奨shimの後方互換（再エクスポートが従来シグネチャを維持）

## 実装アプローチ
- **Outside-In**: 3本番importerの契約テストでエラーレスポンス生成を固定してから移行
- **Red-Green-Refactor**: createErrorResponse移行→shim化→sanitize統一の順にグリーンを維持

## 見積もり
3pt（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: **PBI-20（エラー分類統一）・PBI-21（機密マスキング統一）と重複**。両PBIが未着手の場合、本PBIがその「完了」を担う。二重作業を避けるためスコープ調整すること
- 副作用: エラーメッセージ表示・ログマスキングはユーザー可視。`sanitizeContext`→`maskSensitiveData` の置換でredact強度が変わるため契約テストで固定
- テスタビリティ: すべて純関数。i18nのモックのみ必要

## 実装者向け注記

### 現状コードの確認
```bash
# createErrorResponse の本番importerを確認
grep -rn "createErrorResponse" src/ --glob '!**/__tests__/**'
# sanitizeContext と maskSensitiveData の定義を確認
grep -n "sanitizeContext" src/utils/errorClassification.ts
grep -n "maskSensitiveData" src/utils/sensitiveDataMask.ts
```

### 現状（2026-08-17 確認済み）
- `errorClassification.ts` 255行（`classifyError`/`getUserMessage`/`sanitizeContext` 等を export）
- `errorMessages.ts` 94行（`createErrorResponse` は60行目）。非推奨
- `sensitiveDataMask.ts` 169行（`maskSensitiveData`）。`redaction.ts`/`logMasker.ts` は非推奨
- 本番importer: `messageHandler.ts:10` / `messageHandlers.ts:9` / `dashboardSqliteWiring.ts:9`

### 実装手順
1. `createErrorResponse` を `errorClassification.ts` へ移動
2. 3本番importerの import 元を更新
3. `errorMessages.ts` を @deprecated 再エクスポートshim化
4. `sanitizeContext` の利用箇所を `sensitiveDataMask.maskSensitiveData` に置換
5. 削除テストで旧wrapperの残骸を除去
6. 既存テストを移行・契約テスト追加

### 落とし穴
- `sanitizeContext`（キー名ベース）と `maskSensitiveData`（値ベース）は能力が非重複。置換時にredact対象・強度の差を契約テストで固定し、漏洩防止が後退しないこと
- `createErrorResponse` は `context` 引数（例: `{ url }`）を受け取る。移行時にシグネチャを保持
- 非推奨shimは既存の未移行callerの後方互換用。最終的な削除は別PBIに委ねてよい

## Definition of Done
- [ ] `createErrorResponse` が `errorClassification.ts` に移行している
- [ ] 3本番importerが正規モジュールをimportしている
- [ ] `errorMessages.ts` が再エクスポートshimのみになっている
- [ ] サニタイズが単一系統に統一されている
- [ ] 全テストがパスし `npm run validate` が通過している
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
