# PBI: 持ち出しmoat ― archive正規形と公式export

## ユーザーストーリー
使う人として、記録を他ツールへ持ち出せる形で保ちたい、なぜなら平台の標準整理に飲まれても履歴の本家として残ってほしいから

## 優先度
- 順位: 04 / 5候補
- RICEスコア: 267 (Reach=400 / Impact=2 / Confidence=0.5 / Effort=1.5人週)
- 根拠: 戦略的価値は高いが平台動向の不確実さで確信度0.5。着手は独立可
- 依存: なし。PBI 01のSSOTと干渉させない

## 背景・制約
- `yasumaro_archive_<日付>.db` は現行で平文の標準SQLite(`docs/PRIVACY.md`)。本PBIで正規形にする: スキーマversion+検証子(検証手順を含む)。暗号化は含めない
- 公式exportはMarkdown/CSV/JSONLに限定する。双方向同期・BI直結は含めない
- なぜなぜ分析の解: 表面的要望「CSVがほしい」の裏は「振り返りと移行の自動化」。本PBIは移行可能性として書く。振り返り自動化はPBI 2026-10-22-03側に置く
- `EXPORT_COLUMNS` 固定の緩和は互換方針の見直しとセットにする

## BDD受け入れシナリオ
Scenario: アーカイブを持ち出す
  Given 記録が100件以上ある
  When アーカイブを書き出した
  Then スキーマversion付きの.dbが生成され、検証手順で正当性を確認できる

Scenario: 公式exportで移行する
  Given 記録がある
  When Markdown/CSV/JSONLのいずれかで書き出した
  Then 他ツールで読める形になり、列定義が文書化されている

## 受け入れ基準
- [ ] アーカイブにスキーマversionと検証子がある
- [ ] Markdown/CSV/JSONLの列定義が文書化されている
- [ ] 復元手順が検証済みで、既存DBを壊さない
- [ ] 平文保管の注意書きが維持される

## テスト戦略
- E2E: 書き出し→検証→復元→検索の通し
- 統合: 列追加時の互換テスト、破損ファイルの拒否テスト
- 単体: 列定義・検証子のテーブルテスト

## 見積もり
1.5人週相当。チームで再見積もりすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み(スキーマ・列定義・復元手順を含む)

## 実装記録（2026-10-23・調査のみ・未着手）
- 既存資産の確認（ criterion 1 は既に充足）: アーカイブには `yasumaro_archive_meta` テーブルが実在し、`archive_format_version INTEGER NOT NULL`（スキーマversion）と `yasumaro_version TEXT`（バージョン）を持つ（`src/offscreen/schema.ts:171-182`、PBI 2026-09-06-01 基盤 / 02 record-archive で実施）。`ARCHIVE_FORMAT_VERSION` 定数が書き込み時に記録される（`archiveCreateHandlers.ts:200-210`）。検証子は `src/offscreen/opfsWorker/archiveValidation.ts` の `validateArchiveEngine` と `migrateArchiveStaging`（ALLOWED_TABLES で許可テーブルを固定）
- アーカイブexport: `handleArchiveExport` が staging ファイルを chunk で書き出す（`archiveCreateHandlers.ts:260-277`）。`yasumaro_archive_<日付>.db` の平文SQLite（`docs/PRIVACY.md` 記載）
- 残タスク（次ラウンドの再開点）: (1) Markdown/CSV/JSONL の列定義文書（`docs/` に `AUDIT_LOG_GUIDE.md` は実在するがエクスポート列定義は未確認、`EXPORT_COLUMNS` の固定緩和は互換方針とセット）(2) 復元手順の検証（`handleArchiveRestore` は `archiveRestoreHandlers.ts` に実在、テストの有無を確認）(3) 平文保管の注意書きの維持（`docs/PRIVACY.md` と `public/PRIVACY.md` のバイト同一を保つ）
