# PBI: デザイントークンのコンセプト「研墨」をdev-docs/DESIGN_TOKENS.mdとして文書化する

**作成日**: 2026-07-26
**完了日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（ドキュメント追加のみ）

## 実装メモ（2026-07-26）

`src/styles/tokens.css`（257行）を読み込み、「研墨（けんぼく）」のコンセプト（墨・紙・金の3素材メタファー）と、
装飾用の金（`--ym-color-gold*`）と操作要素用の紫（`--ym-color-primary*`）を明確に分離する設計判断を整理した。
色・タイポグラフィ・スペーシング・ボーダー半径・モーション・質感の全8セクションを表形式でまとめ、
`dev-docs/DESIGN_TOKENS.md` として新規作成した。

`AGENTS.md` の Quick References 表に「Design Tokens」行を追加した。ドキュメントのみの変更のためテストは
追加していない。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Documentation Architect からの指摘。デザイン哲学「研墨」が `src/styles/tokens.css` のコメント内にのみ存在し、デザイナーが参照できるドキュメントになっていない。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "研墨" src/styles/tokens.css
ls dev-docs/DESIGN_TOKENS.md 2>&1
```

`dev-docs/DESIGN_TOKENS.md` が存在しないことを確認済み（2026-07-26時点）。

## 受け入れ基準（BDD）

```gherkin
Scenario: デザイナーがトークン設計思想を参照できる
  Given dev-docs/DESIGN_TOKENS.md が作成されている
  When デザイナーまたは開発者がUIの色・間隔・タイポグラフィを検討する
  Then 「研墨」のコンセプトと、それがどうトークンに反映されているかをドキュメントで確認できる

Scenario: tokens.cssの内容とドキュメントが対応している
  Given src/styles/tokens.css の各トークン定義
  When dev-docs/DESIGN_TOKENS.md を参照する
  Then 主要なトークン（色・間隔・タイポグラフィ）がドキュメントの表と対応している
```

## 受け入れ基準
- [ ] `src/styles/tokens.css` 内のコメントから「研墨」のデザイン哲学を抽出する
- [ ] `dev-docs/DESIGN_TOKENS.md` を新規作成し、コンセプトと主要トークンの対応表を記載する
- [ ] `AGENTS.md` の Quick References 表にリンクを追加する

## テスト戦略

ドキュメントのみの変更のため自動テスト対象外。

## 実装アプローチ

1. `src/styles/tokens.css` のコメントを読み、デザイン哲学を整理する
2. トークン一覧（色・間隔・タイポグラフィ）を表形式でまとめる
3. `dev-docs/DESIGN_TOKENS.md` として新規作成
4. `AGENTS.md` にリンクを追加

## 見積もり

1pt

## 技術的考慮事項
- 依存関係: `src/styles/tokens.css`
- 非機能要件: なし

## Definition of Done
- [ ] `dev-docs/DESIGN_TOKENS.md` が作成されている
- [ ] `AGENTS.md` から参照リンクが張られている
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Documentation Architect指摘）
- 対象コード: `src/styles/tokens.css`
