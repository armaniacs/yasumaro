# PBI: 記録パイプラインのステップスキップ条件をコードコメントで図解する

**作成日**: 2026-07-25
**優先度**: Low
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（コメント追加のみ、ロジック変更なし）

---

## 背景

Checking Team レビュー（2026-07-25）の Domain Logic Expert からの指摘。`src/background/pipeline/steps/` 配下の各ステップは `RecordType` に応じて処理を分岐するが、`previewOnly + force + skipDuplicateCheck` のような予期しないフラグの組み合わせが来た場合の挙動がドキュメント化されていない。新規メンバーがパイプラインを変更する際、どの条件でどのステップがスキップされるかを個別にコードを読んで把握する必要がある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
ls src/background/pipeline/steps/
grep -rn "previewOnly\|skipDuplicateCheck\|force" src/background/pipeline/steps/*.ts
```

RecordingPipeline のステップ実行順序（import順）も合わせて確認し、既に順序を示すコメントが `RecordingPipeline.ts` にないか確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 開発者がステップのスキップ条件を確認する
  Given RecordingPipeline.ts または各ステップファイルにフェーズ図コメントがある
  When 開発者が previewOnly=true のケースでどのステップがスキップされるか調べる
  Then コメントを読むだけで判断できる

Scenario: フラグの組み合わせごとの挙動が明文化されている
  Given フェーズ図コメントに全フラグ組み合わせの表がある
  When force + skipDuplicateCheck が同時に true の場合の挙動を確認する
  Then 意図した挙動なのか未定義動作なのかが分かる
```

## 受け入れ基準
- [ ] `src/background/pipeline/steps/` 配下の各ステップについて、スキップ条件を一覧化する
- [ ] `RecordingPipeline.ts`（またはREADME）にフェーズ図（テキストベースの表 or ASCII図）を追加する
- [ ] `previewOnly + force + skipDuplicateCheck` 等、想定される主要な組み合わせについて期待される挙動を明記する
- [ ] 未定義・非推奨の組み合わせがあれば明記する（コードで防御的にガードするかは別PBIで検討）

## テスト戦略

ドキュメント（コードコメント）追加のみのため自動テスト対象外。既存のパイプラインテストが変更されていないことを確認する。

## 実装アプローチ

1. `src/background/pipeline/steps/` の各ファイルを読み、フラグごとの分岐条件を洗い出す
2. 表形式で「フラグの組み合わせ → 各ステップの実行/スキップ」をまとめる
3. `RecordingPipeline.ts` の先頭コメントとして追加

## 見積もり

1pt（調査とコメント追加のみ）

## 技術的考慮事項
- 依存関係: なし
- 非機能要件: なし

## Definition of Done
- [ ] フェーズ図コメントが `RecordingPipeline.ts` に追加されている
- [ ] 主要なフラグ組み合わせの挙動が明記されている
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Domain Logic Expert指摘）
- 対象コード: `src/background/pipeline/steps/`
