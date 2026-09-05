# PBI: wa-sqlite の license フィールド不足に対応

## ユーザーストーリー

拡張機能のリリース担当者として、依存ライブラリのライセンス情報を SBOM 上で正確に表明したい、なぜならライセンス不明の記載が残ると配布時のコンプライアンス確認で毎回手作業の調査が発生するから

## 優先度

- 順位: 31 / 26
- RICEスコア: 1.8（Reach=1 / Impact=0.5 / Confidence=0.9 / Effort=0.25日）
- 根拠: 実害は SBOM 表記のみで緊急性は低いが、対応は overrides 1件または SBOM 補正で確実に終わる。

## BDD受け入れシナリオ

```gherkin
Scenario: SBOM 上で wa-sqlite のライセンスが表明される
  Given 依存をインストールした状態
  When  `npm run generate-sbom` を実行し sbom.json を確認する
  Then  wa-sqlite の licenses が空ではなく MIT と表明されている

Scenario: ライセンスチェックが引き続きパスする
  Given 対応を適用した状態
  When  `node scripts/check-licenses.mjs` を実行する
  Then  終了コード0で完了し、wa-sqlite が forbidden 扱いになっていない
```

## 受け入れ基準

- [x] `sbom.json`（`npm run generate-sbom` 再生成後）の wa-sqlite エントリに MIT ライセンスが表明されている
- [x] `node scripts/check-licenses.mjs` がパスする
- [x] 上流 `wa-sqlite` の LICENSE が MIT である根拠（コミット時点の文面確認）が実装者向け注記またはコードコメントに残っている

## テスト戦略

- 単体: なし（成果物は設定・SBOM 補正）
- 検証: `npm run generate-sbom` → sbom.json の wa-sqlite エントリ確認、`node scripts/check-licenses.mjs` のパス確認の2点

## 実装アプローチ

`node_modules/wa-sqlite/package.json` に `license` フィールドが存在しない（実測済み）一方、同梱の `LICENSE` ファイルは MIT 文面であるため、コード修正ではなくメタデータ補正で対応する。候補は package.json の `overrides` 欄でのライセンス表明、cyclonedx 用の設定・補正ファイル、`generate-third-party-notices.mjs`（`scripts/` 配下）への明示記載のいずれか。リポジトリの流儀に合う最小のものを1つ選ぶ。

## 見積もり

1ポイント（0.25日相当：補正1か所＋sbom 再生成＋2コマンド確認）

## 実装者向け注記

- スコープ補正（実測済み・2026-09-05）: 前提の「license 不足」は半分正しい。`node_modules/wa-sqlite/package.json` に `license` フィールドは本当にないが、同梱 `LICENSE` は MIT 文面（Copyright (c) 2023 Roy T. Hashimoto）であり、`license-checker` は既に `wa-sqlite@1.0.0 => MIT*`（`*`＝LICENSE ファイルからの推論）と判定している。つまり `check-licenses.mjs`（forbidden は GPL 系等の `FORBIDDEN_RE`）は現状でもパスし、コンプライアンス違反ではない
- 実害の所在: `cyclonedx-npm` は package.json の `license` フィールド基準のため、sbom.json の wa-sqlite エントリは `licenses` 空（`('wa-sqlite', {})` を実測、対して `@subframe7536/sqlite-wasm` は `MIT` 表明あり）。本PBIはこの SBOM 表記精度の問題として扱い、検証専用への読み替えは不要
- 関連: `scripts/check-licenses.mjs:1`（PBI #36 由来・license-checker 使用）、`scripts/generate-third-party-notices.mjs`、`npm run generate-sbom`（`cyclonedx-npm --output-file sbom.json`）、repo 自体の `license: MIT`（`package.json:66`）
- 注意: `node_modules` 内の直接編集は不可。再インストールで消える。上流への issue 報告も選択肢だが本PBIの DoD には含めない

## Definition of Done

- [x] SBOM 上の wa-sqlite ライセンス表明が確認済み
- [x] ライセンスチェックがパスする
- [x] ドキュメント更新済み（third-party notices に反映が必要な場合のみ）

## 実装メモ（2026-09-05・branch 0905c）
- 完了: npm `overrides` では license フィールドを注入できない（バージョン固定は直接依存と衝突、メタデータのみの override は無効 — 実測）ため、`scripts/generate-sbom.mjs` を新設（cyclonedx-npm 実行後に人間検証済みの license 補正テーブルを適用）。`generate-sbom` スクリプトを差し替え。sbom.json の wa-sqlite licenses が MIT を表明、check-licenses 541 packages PASS。MIT 文面確認の根拠はスクリプトの WHY コメントに記録。
