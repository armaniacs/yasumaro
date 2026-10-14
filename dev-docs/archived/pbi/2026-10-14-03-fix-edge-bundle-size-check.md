# PBI: Edge ビルドのバンドルサイズチェック追加

## ユーザーストーリー
保守担当の開発者として、Edge ビルドにもバンドルサイズ予算チェックを入れたい、なぜなら Chrome と Firefox にはあるのに Edge にはなく、Edge も配布対象なのに肥大化が早期検出されないから。

## 優先度
- 順位: 03 / 4
- RICEスコア: 10.0（Reach=5 / Impact=0.5 / Confidence=1.0 / Effort=0.25）
- 根拠: リリース毎に通る経路。Edge は Chrome と同源で乖離リスクは低いが、チェック自体は 1 行。
- 出所: holistic-code-review（2026-10-14、差分スコープ 49ca0c62..HEAD）テーマ4

## 背景（2026-10-14 時点の現状）
- `.github/workflows/release.yml:43-44`（chrome-mv3）と `:61-62`（firefox-mv3）には `npm run check-bundle-size -- <target>` がある。
- Edge ビルド（`:63-66`、`npx wxt zip -b edge`）にはチェックがなく、次のステップ（List output archives）へ直接進む。
- `scripts/check-bundle-size.mjs:56` は `process.argv[2] || 'chromium-mv3'` で任意の dist サブディレクトリを受け付ける。wxt -b edge の出力先は `dist/edge-mv3`。
- MAX_BUNDLE_BYTES は 15 MB（`scripts/check-bundle-size.mjs:23`）。

## BDDシナリオ
Scenario: Edge ビルドも予算チェックを通る
  Given リリースパイプラインが Edge ビルドを完了する
  When check-bundle-size -- edge-mv3 が実行される
  Then 15 MB 以下であればステップが成功する

Scenario: Edge ビルドの肥大化は早期に失敗する
  Given Edge ビルドの出力が 15 MB を超えた
  When check-bundle-size -- edge-mv3 が実行される
  Then exit 1 で失敗し、リリースが停止する

## 受け入れ基準
- [x] Edge ビルド直後に `npm run check-bundle-size -- edge-mv3` が実行される
- [x] chrome / firefox と同じステップ形式で追加する（名前も同系に揃える）
- [x] 既存ステップの順序・内容は変更しない（diff は追記のみ）
- [x] release.yml の YAML 構文が有効である

## テスト戦略
- ワークフロー定義は単体テスト対象外のため、検証は YAML 構文パースと diff の目視確認で行う
- check-bundle-size のロジック自体は既存単体テストが担保（scripts 配下）
- 統合: 実際の検証は次回タグ push の実行で行う

## 見積もり
0.25 SP（1 行追記）

## 実行結果（2026-10-14）
- `Check edge bundle size` ステップを Edge ビルド直後に追加（`release.yml`、コミット `cb1bc53`）。chrome / firefox と同型のステップ名・形式。
- YAML 構文は js-yaml パースで検証。最終ゲート `npm run validate` exit 0（1063 files / 16036 tests passed）+ `npm run build` PASS。

## Definition of Done
- [x] 受け入れ基準がすべて満たされている
- [x] lint / type-check が通る（リポジトリ全体が green のこと）
- [x] コードレビュー完了
