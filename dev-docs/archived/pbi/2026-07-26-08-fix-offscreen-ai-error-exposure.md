# PBI: offscreen.tsのAI Promptエラー出力をマスキング経由にする

**作成日**: 2026-07-26
**完了日**: 2026-07-26
**優先度**: Medium
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（console出力の内容を変更するのみ、処理フローに影響しない）

## 実装メモ（2026-07-26）

`src/offscreen/offscreen.ts` 内で生のエラーオブジェクトを直接 `console.error` に渡していた4箇所
（115, 151, 473, 496行目）を全て `errorMessage(error)` でラップする形に修正した。指摘対象の473行目
（Prompt extraction failed）以外に、`ensureSession`内の2箇所（115, 151行目）と`handleOffscreenMessage`
の汎用catch（496行目）も同様のパターンだったため合わせて修正した。

**訂正**: PBIタイトルは「マスキング経由」としていたが、`errorMessage()`（`src/utils/errorUtils.ts`）は
実際には`error instanceof Error ? error.message : String(error)`という単純な文字列抽出のみで、
PIIマスキングは行っていない。テスト実装時にこの誤解に気づき（PIIを含むエラーメッセージがそのまま
通過することを確認）、本PBIの実質的な効果は「生のErrorオブジェクト全体（stackトレース等を含む）を
ログに出さず、`.message`文字列のみに絞る」ことであり、PIIサニタイズは別の関心事（PBI-07で対応した
`addLog`のPIIマスキングとは異なるレイヤー）であることを明確にした。

`offscreen.test.ts`の`ensureSession`ブロックに、セッション生成失敗時に`console.error`へ渡される
引数が生の`Error`オブジェクトではなく抽出済み文字列であることを検証するテストを1件追加した。
既存30件と合わせて全てパス。型チェック・全テストスイート（7364件）ともに回帰なし。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Blue Team Leader からの指摘。`src/offscreen/offscreen.ts:472`（現状 `console.error('Offscreen: Prompt extraction failed', promptError)`）で、AI プロンプト実行エラー時に生のエラーオブジェクトをそのまま `console.error` に出力している。エラー内容にAIレスポンスの一部や入出力データ（ユーザーが閲覧したページの内容等）が含まれる可能性がある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "console.error\|errorMessage" src/offscreen/offscreen.ts
```

同ファイル内で既に `errorMessage()` ユーティリティがimportされ他の箇所で使われているか確認し、一貫した形で適用する。

## 受け入れ基準（BDD）

```gherkin
Scenario: AI Promptエラーがマスキングされてログ出力される
  Given AIプロンプト実行が失敗し、エラーオブジェクトにセンシティブな内容が含まれる
  When console.errorでエラーを出力する
  Then errorMessage()でラップされたマスク済みの文字列のみが出力される

Scenario: 既存のエラーハンドリング（sendResponse）が変わらない
  Given AIプロンプト実行エラー
  When エラーハンドリングを実行する
  Then sendResponseへの応答内容（success: false, error: ...）は既存通り返される
```

## 受け入れ基準
- [ ] `offscreen.ts:472` の `console.error('Offscreen: Prompt extraction failed', promptError)` を `console.error('Offscreen: Prompt extraction failed', errorMessage(promptError))` に変更する
- [ ] 他に同様の生エラーオブジェクトをそのまま出力している箇所がないか `offscreen.ts` 全体を確認し、あれば同様に修正する
- [ ] 既存の `offscreen` 関連テストが全てパスする

## テスト戦略

### 単体テスト
- `console.error` のモックで、渡される引数がマスク済み文字列であることを確認するテストを追加

## 実装アプローチ

1. `offscreen.ts` 内の全 `console.error`/`console.log` 呼び出しを確認し、生エラーオブジェクトを渡している箇所を洗い出す
2. `errorMessage()` でラップする形に修正する

## 見積もり

1pt

## 技術的考慮事項
- 依存関係: `src/utils/errorUtils.ts` の `errorMessage()`
- 非機能要件: セキュリティ（ログ経由の情報漏洩防止）

## Definition of Done
- [ ] AI Promptエラー出力がマスキング経由になっている
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Blue Team Leader指摘）
- 対象コード: `src/offscreen/offscreen.ts:472-475`
- 関連PBI: `2026-07-26-17-refactor-console-to-structured-logger.md`（console.*全体の構造化ロガー置き換え）
