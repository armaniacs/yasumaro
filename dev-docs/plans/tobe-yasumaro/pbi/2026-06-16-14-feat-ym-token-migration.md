# PBI-14: 既存セレクタの `--ym-*` トークン移行（dashboard.css）

> 種別: feat（CSS リファクタリング）
> 依存: PBI-09（`--ym-*` 変数定義完了が前提）
> 進め方: 機械的置換 + 目視確認

## ユーザーストーリー

開発者として、dashboard.css の全セレクタが `--ym-*` デザイントークンを参照するようにしたい、なぜなら PBI-09 で定義したトークンを実際の UI に反映し、既存の `--color-*` 変数と `--ym-*` の混在状態を解消したいからだ。

## スコープ

- `entrypoints/options/dashboard.css` 全セレクタの `--color-*` / `--space-*` / `--radius-*` / `--transition-*` → `--ym-*` 置換
- `entrypoints/options/models-dev-dialog.css` の primary 色置換（`#007bff` → `var(--ym-color-primary)`）
- `entrypoints/permissions/privacy.css` の変数名統一（`--bg` → `--ym-*`）

## 除外

- ポップアップ（PBI-15）
- TypeScript ファイル（PBI-09 内で対応）

## ストーリーポイント

3〜5 SP（dashboard.css 3,458 行の広範囲な置換）
