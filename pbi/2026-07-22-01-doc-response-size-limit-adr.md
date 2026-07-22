# PBI: require-response-size-limit 用の独立した ADR を作成

**作成日**: 2026-07-22
**優先度**: Medium
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟢なし（ドキュメント追加のみ）

---

## 背景

Checking Team レビュー（2026-07-22）の System Architect からの指摘により、現在の ADR `2026-07-22-markdown-output-sanitization-guardrail.md` が2つの独立した脆弱性クラス（CWE-79/XSS と CWE-400/リソース枯渇）を混在させていることが判明した。

`require-response-size-limit` ルールはリソース枯渇対策であり、マークダウンサニタイズとは独立した関心事である。トレーサビリティを向上させるため、独立した ADR で文書化する必要がある。

## 受け入れ基準（BDD）

### シナリオ 1: 独立した ADR が作成される
```gherkin
Given dev-docs/ADR/ ディレクトリが存在する
When require-response-size-limit 用の ADR を作成する
Then ファイル名は "YYYY-MM-DD-response-size-limit-guardrail.md" 形式である
And ADR には以下のセクションが含まれる:
  - 背景（VulnHunter での指摘経緯）
  - 決定（3層ガードレールの定義）
  - 使用するチェックパターン
  - トレードオフ（メリット・デメリット）
  - 影響を受けるコンポーネント
  - 将来の改善案
```

### シナリオ 2: 元の ADR から参照が追加される
```gherkin
Given dev-docs/ADR/2026-07-22-markdown-output-sanitization-guardrail.md が存在する
When 元の ADR を更新する
Then "関連 ADR" セクションに require-response-size-limit 用 ADR へのリンクが追加される
```

### シナリオ 3: ADR の内容が正確である
```gherkin
Given require-response-size-limit ルールが eslint/rules/require-response-size-limit.mjs に存在する
When ADR を読む
Then ルールの目的（response.text() 呼び出し前のサイズ制限チェック検出）が説明されている
And 検出パターン（content-length, maxSize, sizeLimit 等）が列挙されている
And 現在の制限事項（トークンベースのヒューリスティック）が明記されている
```

## 実装タスク

- [ ] `dev-docs/ADR/YYYY-MM-DD-response-size-limit-guardrail.md` を作成
- [ ] 背景セクションを記述（VulnHunter での指摘経緯）
- [ ] 決定セクションを記述（3層ガードレールの定義）
- [ ] 使用するチェックパターンを列挙
- [ ] トレードオフセクションを記述
- [ ] 影響を受けるコンポーネントを列挙
- [ ] 将来の改善案を記述
- [ ] 元の ADR に「関連 ADR」セクションを追加
- [ ] ADR のリンク整合性を確認

## 完了条件

- [ ] 独立した ADR が作成されている
- [ ] 元の ADR に参照リンクが追加されている
- [ ] ADR の内容が実際のルール実装と一致している
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連

- Checking Team レポート: `plans/2026-07-22-1716-review-main.md`
- 元の ADR: `dev-docs/ADR/2026-07-22-markdown-output-sanitization-guardrail.md`
- ルール実装: `eslint/rules/require-response-size-limit.mjs`
