# PBI: stripビルドに残るプローブ残存コードを完全に除去する

- 種別: chore
- RICE: 2.4（R3 × I0.5 × C0.8 / E0.5）
- 依存: なし（NN12 と同ファイル別ハンクのため実装は NN12 の後に直列。W2 単独）
- バッチ: review-followup
- 台帳: `pbi/2026-10-11-00-backlog-review-followup.md`
- 出所: code-review レビュー指摘 #4（2026-10-11）

## ユーザーストーリー

出荷責任者として、ストア出荷物にテスト用コードの残骸を残したくない。なぜなら `OW_E2E_PROBE=0` ビルドでも `__OW_TEST_STATE` 書き込みブロックが bundle に残り、「除去した」という主張と成果物が一致していないから。

## 優先度

- 順位: 4 / 5
- RICEスコア: 2.4（Reach=3 / Impact=0.5 / Confidence=0.8 / Effort=0.5）
- 根拠: 出荷物のバイト衛生（Impact 0.5）。活性化経路は既に存在しないため実害はなく、除去の完全性確認に一手間（C 0.8）。

## 背景（現状・証拠）

- `OW_E2E_PROBE=0` ビルド後の `dist/chromium-mv3/content-extractor.js` に `__OW_TEST_STATE` が3件残る（実測済み）。
- 発生源: `src/content/contentKernel.ts:242` 付近の `if (this.gating.isE2E && ... && window.__OW_TEST_STATE)` ブロック。strip 時 `gating.isE2E` は恒等 false のため到達不能だが、静的には消えない（session 読みが実行時値のため定数畳み込みが届かない）。
- 活性化経路はない（`isE2EProbeEnabled()` が先に false 短絡）ため実害なし。defense-in-depth の仕上げ。

## BDD 受け入れシナリオ

```gherkin
Scenario: stripビルドにプローブ文字列が残らない
  Given OW_E2E_PROBE=0 でビルドする
  When bundle を grep する
  Then owE2eProbeEnabled / owE2eTestState / data-ow-test-state / data-ow-e2e-test / __OW_TEST_STATE のいずれも現れない

Scenario: 通常ビルドの挙動が変わらない
  Given 既定ビルドで E2E を実行する
  When プローブを armed して記録条件を満たす
  Then isValidVisitReported の追従（line 242 ブロックの効果）が従来通り動く
```

## 受け入れ基準

- [ ] `E2E_PROBE_COMPILED_IN` を `contentKernel.ts` に import し、line 242 付近のブロックをビルド時 flag でゲートする（または同等の静的除去）
- [ ] `OW_E2E_PROBE=0` ビルドの grep で上記5文字列がすべてゼロ件
- [ ] 既定ビルドの挙動不変（既存の隔離・golden テストが無変更で green）
- [ ] `npm run validate` が green

## テスト戦略

- ビルド検証: `npm run build`＋`OW_E2E_PROBE=0 npx wxt build` の2通り＋5文字列 grep（NN08 実装時に確立した手順を再利用）。
- unit: `contentKernel.e2eProbeIsolation.test.ts`・golden が無変更 green（通常ビルド経路の挙動不変の証拠）。
- E2E: headed 実行で Scenario 2 を確認（回せなければ未検証旨を記録）。

## 見積もり

0.5 SP（import＋ゲート1箇所＋両ビルド grep 確認）

## 技術的考慮事項

- `E2E_PROBE_COMPILED_IN` は `typeof __OW_E2E_PROBE__ === 'undefined' || ...` の const のため、wxt の define 置換後は静的 false になり、esbuild の到達不能除去が効く。minify 前後での残存有無を grep で確認すること。
- NN12 と同ファイル（別ハンク）を触るため、NN12 着地後に rebase してから着手する。

## 実装者向け注記

### 実装手順

1. NN12 の着地を確認する
2. import＋ゲートを追加する
3. 両ビルド＋grep、`npm run validate`
4. headed E2E（回せなければ記録のみ）

### 落とし穴

- ゲート条件を `!E2E_PROBE_COMPILED_IN || ...` の形にすると通常ビルドで short-circuit 順が変わらないよう注意（挙動不変が最優先。素直なのは外側 `if (E2E_PROBE_COMPILED_IN && this.gating.isE2E && ...)`）

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate` が green
- [ ] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする
