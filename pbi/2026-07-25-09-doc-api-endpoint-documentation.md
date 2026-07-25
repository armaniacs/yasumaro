# PBI: Obsidian Local REST API エンドポイント一覧をドキュメント化する

**作成日**: 2026-07-25
**優先度**: Low
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（ドキュメント追加のみ）

---

## 背景

Checking Team レビュー（2026-07-25, `plans/2026-07-25-2019-review-main.md`）の Documentation Architect からの指摘。`src/background/obsidianClient.ts` が呼び出す Obsidian Local REST API のエンドポイント（`/vault/{path}` 等）が、コード内にのみ存在し `dev-docs/` 配下にエンドポイント一覧・仕様書としてまとまっていない。新規貢献者やAPI変更時の影響調査がコードを読むことに依存している。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "baseUrl\|/vault/\|fetch(" src/background/obsidianClient.ts
find dev-docs -iname "*api*"
```

`dev-docs/DESIGN_SPECIFICATIONS.md` や `dev-docs/ERROR_CODES.md` は存在するが、API エンドポイント表は見当たらないことを確認済み（2026-07-25時点）。ドキュメントが既に追加されていないか再確認してから着手する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 開発者がObsidianClientのAPI仕様を確認する
  Given dev-docs/ 配下にAPIエンドポイント一覧ドキュメントが存在する
  When 開発者が obsidianClient.ts の変更を検討する
  Then ドキュメントを見るだけで使用中の全エンドポイント・メソッド・パラメータを把握できる

Scenario: エンドポイント変更時にドキュメントが追従する
  Given dev-docs/API_ENDPOINTS.md にエンドポイント一覧がある
  When obsidianClient.ts に新しいエンドポイント呼び出しが追加される
  Then 対応するドキュメント更新がPRレビューのチェック項目として認識できる
```

## 受け入れ基準
- [ ] `dev-docs/API_ENDPOINTS.md`（または既存ドキュメントへの追記）に Obsidian Local REST API の使用エンドポイント一覧を作成する
- [ ] 各エンドポイントについてメソッド・パス・用途・呼び出し元関数名を記載する
- [ ] `AGENTS.md` の Quick References 表に新規ドキュメントへのリンクを追加する

## テスト戦略

ドキュメントのみの変更のため自動テスト対象外。レビューでコード（`obsidianClient.ts`）とドキュメントの記載が一致することを確認する。

## 実装アプローチ

1. `src/background/obsidianClient.ts` 内の `fetch` 呼び出し箇所を全て洗い出す
2. エンドポイントごとに表形式でまとめる（メソッド / パス / 用途 / 関数名）
3. `dev-docs/API_ENDPOINTS.md` として新規作成

## 見積もり

1pt（ドキュメント作成のみ、コード変更なし）

## 技術的考慮事項
- 依存関係: なし
- 非機能要件: なし

## Definition of Done
- [ ] `dev-docs/API_ENDPOINTS.md` が作成されている
- [ ] `AGENTS.md` から参照リンクが張られている
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Documentation Architect指摘）
- 対象コード: `src/background/obsidianClient.ts`
