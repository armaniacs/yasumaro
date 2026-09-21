# PBI: utils 層の utils→background 静的依存（auditLog・aiModelKey）を解消する

## ユーザーストーリー
開発者として、utils 層から background 層への静的依存をなくしたい、なぜなら層ルールで逆方向依存が禁止されているにもかかわらず auditLog と aiModelKey の2辺が残存し、strategy グラフの引きずりと lint 検出漏れの温床になっているから

## 優先度
- 順位: 5 / 5
- RICEスコア: 8.0（Reach=4 / Impact=2 / Confidence=100% / Effort=1.0週）
- 種別: refactor
- 根拠: 公開挙動は変えない層健全性の改善であり Reach は絞られるが、禁止辺の残存は strategy グラフ肥大と将来の循環依存の呼び水になるため Impact は 2。修正先のパターンと移動先は確定済みのため Confidence は 100%

## ビジネス価値
utils→background の禁止辺が消え、層境界の機械検査とレビューの信頼性が回復する。strategy グラフの意図せぬ引きずりがなくなり、将来の background 側リファクタ（provider 追加・sqlite 配線変更）の波及範囲が background 層内に閉じる

## BDD受け入れシナリオ

```gherkin
Scenario: auditLog がモジュール読み込み時に background を静的解決しない
  Given auditLog を import する
  When モジュールを読み込む
  Then background/sqlite/offscreenGateway への静的 import が存在せず、SqliteClient の解決は呼び出し時の遅延 import で行われる

Scenario: aiModelKey 経由で strategy グラフが引きずられない
  Given utils 層のモジュールを import する
  When aiModelKey の解決経路をたどる
  Then background/ai/providerCatalog への静的 import が utils 層に存在せず、strategy グラフは background 層内に閉じる

Scenario: 公開挙動が不変である
  Given RemoteAIService が要約を生成する
  When auditLog 記録とモデルキー解決が実行される
  Then 記録内容と解決キーは変更前と同一である
```

## 受け入れ基準
- [x] `auditLog` が `offscreenGateway` への静的 import を持たず、storageMaintenance 流儀の遅延 import で解決する
- [x] `aiModelKey` が `src/background/ai/` 配下に移動し、utils 層から providerCatalog への静的辺が消える
- [x] `RemoteAIService` と関連テストの import 先が新配置に更新され、型チェックと単体テストが green である
- [x] `providerAllowlist.ts` に変更がない（PBI 13 の担当範囲と重ならない）
- [x] 監査ログ記録とモデルキー解決の公開挙動が不変である
- [x] utils→background の静的辺が残存しないことを grep で確認できる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外(内部構造改善。公開挙動不変のため E2E の追加はしない)

### 統合テスト
- RemoteAIService 経由の要約生成で auditLog 記録とモデルキー解決が従来通り動作すること
- utils 層から background 層への静的 import が存在しないことの grep 検査

### 単体テスト
- auditLog の遅延解決パス（成功・失敗時の best-effort 振る舞い）
- resolveModelKey の既知 provider・未知 provider（汎用キーへの fail-closed）の振る舞い

## 実装アプローチ
- **Inside-Out**: auditLog の遅延 import 化を先に Red-Green で行い、次に aiModelKey の移動と importers 更新を行う
- 既存の auditLog・resolveModelKey の単体テストを先に確保し、Green のまま辺だけを付け替える
- providerAllowlist は参照実装として読むだけで変更しない

## 見積もり
2ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: PBI 13 が `providerAllowlist.ts` に触るため、本 PBI では同ファイルを変更しない。他 PBI との順序制約はない
- 遵守すべき ADR: LAYERS.md の依存ルール（逆方向依存禁止）と Layer 1-循環の遅延 import 規約
- 非機能要件: 公開挙動不変。auditLog は best-effort（失敗時はログのみで throw しない）を維持する

## 実装者向け注記

### 現状の証拠
- 静的逆辺その1: `src/utils/auditLog.ts:7` が `../background/sqlite/offscreenGateway.js` を静的 import し、`src/utils/auditLog.ts:18` でモジュール読み込み時に `const sqliteClient = getSharedSqliteClient()` を実行する
- 禁止根拠: `dev-docs/LAYERS.md:134` は「逆方向依存 (utils → background) は禁止」と明記する
- 正規パターン: `dev-docs/LAYERS.md:87-89` 記載の `src/utils/storage/storageMaintenance.ts:24` が `await import('../../background/sqlite/offscreenGateway.js')` で遅延解決し、utils→background の静的逆辺を回避する
- 静的逆辺その2: `src/utils/aiModelKey.ts:12` が `../background/ai/providerCatalog.js` を import し、strategy グラフを引きずる
- 唯一の production 消費者: `src/background/ai/RemoteAIService.ts:19` が `recordAuditLog` を、`src/background/ai/RemoteAIService.ts:13` が `resolveModelKey` を import する（いずれも background 層内からの利用）
- strategy 回避の意図: `src/background/messageTypes.ts:9-12` は aiClient 経由の strategy グラフ引きずりを避ける配慮を記録しており、aiModelKey の静的辺はそれを無効化する経路になる
- 同型の既修クラス: `src/utils/storage/providerAllowlist.ts:1-12` のコメントに中立行化の経緯を記録（本 PBI では変更対象外）
- lint の検出限界: `utils-layer-boundary` は未分類ファイルのため当該2辺を検出できない。grep による目視確認が必要

## Definition of Done
- [x] 全BDDシナリオ実装+パス
- [x] コードレビュー完了
- [x] 統合検証 green
