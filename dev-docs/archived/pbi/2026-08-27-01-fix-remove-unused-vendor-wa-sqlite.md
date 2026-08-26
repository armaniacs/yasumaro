# PBI: vendor/wa-sqlite/ の削除

## ユーザーストーリー

開発者として、`vendor/wa-sqlite/` にある未参照のWASMビルド成果物を削除したい、
なぜならリポジトリ内に「どちらが本物のWASMか」という混乱を生む重複資産を残したくないから。

## 優先度

- 順位: 01 / 4
- RICEスコア: 15.0（Reach=3 / Impact=0.5 / Confidence=100% / Effort=0.1）
- 根拠: `vendor/wa-sqlite/wa-sqlite-async.wasm` は `node_modules/wa-sqlite/dist/wa-sqlite-async.wasm` と
  SHA1完全一致。ソースツリー中に `vendor/wa-sqlite` を参照する箇所は0件（`grep -rn "vendor/wa-sqlite" src/ entrypoints/` で確認済み）。
  実行時は常に `node_modules/wa-sqlite`（package.json記載のnpm依存）経由でバンドルされるため、
  このディレクトリを消してもビルド・移行機能のいずれにも影響しない。他候補への依存なし、即実行可能。

## BDDシナリオ

Scenario: vendor/wa-sqlite/ 削除後もビルドが成功する
  Given `vendor/wa-sqlite/` ディレクトリが削除されている
  When  `npm run build` を実行する
  Then  ビルドが正常に完了し、`dist/chromium-mv3/` に4種のwasmファイルが変わらず生成される

Scenario: 旧DB移行機能が引き続き動作する
  Given `vendor/wa-sqlite/` ディレクトリが削除されている
  When  OPFS移行が必要な旧DBを持つブラウザで拡張機能を起動する
  Then  `node_modules/wa-sqlite` 経由の移行処理が従来どおり実行される

## 受け入れ基準

- [ ] `vendor/wa-sqlite/wa-sqlite-async.wasm`, `wa-sqlite-async.mjs`, `build-wasm.sh` を削除する
- [ ] `npm run build` が成功し、既存の4種wasmファイルが変わらず生成される
- [ ] `npm run validate`（型チェック＋テスト）が通る
- [ ] FTS5対応wasmの再ビルド手順（`build-wasm.sh`の内容）は、削除前に `dev-docs/` 等へ手順書として残すか判断する

## テスト戦略

- 統合: `npm run build` 後の `dist/chromium-mv3/assets/*.wasm` の生成確認（既存のビルド検証に含まれる）
- 単体: 既存の移行系テスト（`migrationBackup.test.ts` 等）が変更なしで通ることを確認

## 見積もり

1pt（🟢低）

## Definition of Done

- [ ] 対象3ファイルが削除されている
- [ ] ビルド・テストがグリーン
- [ ] コードレビュー完了
