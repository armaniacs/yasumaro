# PBI: 既存WASMバンドルの統合（sync/async重複排除）【現時点では未着手】

> **この PBI は将来実装するためのものであり、現時点では着手しない。**
> [03: 旧wa-sqlite移行コードの終息判断](2026-08-27-03-investigate-legacy-migration-sunset.md) が
> 完了し、移行コードの扱いが確定してから着手する。

## ユーザーストーリー

ユーザーとして、拡張機能のバンドルサイズが小さくなってほしい、なぜならビルド後の
`dist/` には4つの.wasmファイル（sync版2種+async版2種、うち3種・約2.7MBは旧DB移行専用の
一時的コードから発生している）が含まれており、実際に使われない資産まで配布されているから。

## 優先度

- 順位: 04 / 4
- RICEスコア: 3.5（Reach=5 / Impact=2 / Confidence=70% / Effort=2）
- 根拠: `dist/chromium-mv3/assets/` に生成される4つの.wasmのうち、本番稼働に必須なのは
  `@subframe7536/sqlite-wasm` 経由の1つ（`wa-sqlite-async-Dl8rgPlb.wasm`, 1.4MB）のみ。
  残る3つ（sync版2種 545K+710K、async版1種1.4MB、計約2.7MB）は `opfsMigrationV2Reader.ts` と
  `migrationBackup.ts` の動的importがViteのビルド時静的解析で到達可能と判定されバンドルされている
  ものであり、旧DB移行という一時的な用途にしか使われない。**[03]で移行コードの終息時期が
  確定しない限り、このコードを安全に削除・統合する判断ができないため、依存関係として先行させる。**
  Confidenceを70%とするのは、Vite側のchunk分割挙動（動的importをworker分離等でどこまで
  tree-shake可能か）に技術的な検証余地が残るため。

## BDDシナリオ

Scenario: 移行コード終息後の統合
  Given [03]で移行コードの終息（またはリテンション期限）が確定している
  When  終息時期を迎え、`opfsMigrationV2Reader.ts` / `migrationBackup.ts` の
        wa-sqlite動的importを除去する
  Then  `dist/` に生成されるwasmファイルが本番用の1つのみになる

Scenario: 終息前の暫定統合（移行コードを残したまま重複だけ減らす場合）
  Given 移行コードはまだ残す必要がある
  When  sync/async版の重複バンドルを見直す（例: 動的importの分離、chunk分割設定の見直し）
  Then  移行機能を壊さずにバンドルサイズが削減される

## 受け入れ基準

- [ ] [03]の終息判断結果に基づき、統合方針（完全削除 or 暫定圧縮）を選択する
- [ ] 統合後、`dist/chromium-mv3/assets/*.wasm` の合計サイズが現状（約4MB）から
      本番稼働分（約1.4MB）近くまで削減される
- [ ] 旧DB移行機能が必要な間は、統合後も正しく動作する（終息前に着手する場合）
- [ ] `npm run build` / `npm run validate` が通る

## テスト戦略

- 統合: ビルド後のバンドルサイズ検証、移行系テスト（`migrationBackup.test.ts`,
  `opfsMigrationV2*.test.ts` 相当）が引き続き通ることの確認
- 単体: chunk分割・動的import変更に伴う既存ユニットテストの回帰確認

## 見積もり

3pt（🔴高、Vite/WXTのビルド設定変更と移行コードへの影響評価を伴う）

## Definition of Done

- [ ] [03]の終息判断が完了している（本PBIの前提条件）
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] バンドルサイズ削減効果が確認できる
- [ ] コードレビュー完了
