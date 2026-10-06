# PBI: audit_log のデコード双子を codec に畳む

## ユーザーストーリー

監査ログの保守担当者として、audit_log の行形状が rowCodec の列境界一意所有に乗ってほしい。位置/名前両デコーダが statement 出力ごとに 2 重で、records/search の統合（1006-11）の未カバーシブリングになっているから。

## 優先度

- 順位: 10/17
- RICE: 3.0（R3 / I1 / C1.0 / E1）
- 根拠: 実証済みパターン（1006-11）の同型適用。audit trail はプライバシー関連テーブルで静かなデコード乖離を閉じる価値がある
- 依存: NN05 の着地後（同一ファイル `IdbVfsBackend.ts` の編集競合回避）

## 背景（file:line 現状）

- 位置デコード: `src/offscreen/IdbVfsBackend.ts:376-388` — `id: Number(row[0])...` 手書き
- 名前デコード: `src/offscreen/opfsWorker/auditHandlers.ts:36-49` — `id: Number(row.id)...` 手書き
- 同一 statement: `'INSERT INTO audit_log (provider, url, created_at) VALUES (?, ?, ?)'`（`IdbVfsBackend.ts:358` = `auditHandlers.ts:18`、`queryPlan.ts:653-663` の buildAuditLogStatements）
- 影響: audit_log への schema 変更（列追加等）が 2 つの読み手に手動反映必須。compile 時に一緒に壊れない

## BDD受け入れシナリオ

```gherkin
Scenario: 両バックエンドの audit デコードが共有列リストから派生する
  Given AUDIT_LOG_COLUMNS + mapPositional / mapNamed が提供されている
  When IdbVfsBackend と opfsWorker auditHandlers が audit 行をデコードする
  Then 手書きインラインデコーダが消え共有 codec が使われる

Scenario: 監査ログの既存 wire 形状は不変
  Given 既存の audit ログ表示
  When デコードが codec 経由になる
  Then 出力形状・coercion 語義が従来と同一である
```

## 受け入れ基準

- [ ] AUDIT_LOG_COLUMNS を rowCodec.ts に追加し、両バックエンドが mapPositional / mapNamed を再利用する
- [ ] `IdbVfsBackend.ts:376-388` と `auditHandlers.ts:36-49` のインラインデコーダを削除
- [ ] coercion 語義（Number/String）が従来と同一であることを pin するテストを維持
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- unit: `src/offscreen/__tests__/` の既存 audit テストを維持し、codec 経由の期待値が不変であることを確認
- 配置: `src/**/__tests__/`、実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
