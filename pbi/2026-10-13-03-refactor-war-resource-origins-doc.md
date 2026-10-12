# PBI: warResourceResolves の対応起源をコメントに明記する

code-review（2026-10-13）の指摘3 から起票。

## ユーザーストーリー

web_accessible_resources に資源を追加する開発者として、`warResourceResolves` がどの起源を解釈できるかコメントで分かることがほしい、なぜなら将来のモジュール分割で WAR に src 由来のチャンクを足した時に偽 fail して混乱するから。

## 優先度

- 順位: 03 / 全候補数 7
- RICEスコア: **2.0**（Reach=2 / Impact=0.25 / Confidence=1.0 / Effort=0.25）
- 根拠: WAR が増える時のみ関与（Reach 2）。実害なしのドキュメント改善だが、同点候補の中でリスク軽減効果が最も高い（偽 fail は「保護が壊れた」という誤解を生む）。同点タイブレーク規則による。

## 背景

- `src/__tests__/manifest.test.ts` の `warResourceResolves()`（245-253 行）は `.js` を `entrypoints/<name>.ts` 由来、それ以外を `public/` 由来として解決する。現行 WAR 2 件（`content-extractor.js` / `icons/icon48.png`）には合致する。
- CLAUDE.local.md のモジュール分割ルールは `utils/foo.js` 等の WAR 追加を前提にしている（WXT 移行前の manifest.json 時代のルール）。WXT 配下で src 由来のチャンクが WAR に入る場合、この解決チェックは偽 fail する。
- 対応起源と「WAR が増えた時点で拡張する」前提がコメントに無いため、将来の実装者が原因の切り分けに時間を使う。

## BDD受け入れシナリオ

Scenario: 対応起源がコメントから分かる
  Given warResourceResolves の直上コメント
  When  読む
  Then  対応する 2 起源（entrypoints/<name>.ts 由来の .js / public/ 由来のそれ以外）と、WAR が増えた時の拡張前提が書かれている

Scenario: 動作は変わらない
  Given 現行 WAR 2 件
  When  stale チェック（declares only resources that resolve to a source file）が走る
  Then  従来どおり green（コメントのみの変更）

## 受け入れ基準

- [ ] `warResourceResolves` の直上（または関数内）に、対応する 2 起源と拡張前提のコメントが追記されている
- [ ] コードの動作は変わらない（`npx vitest run src/__tests__/manifest.test.ts` が green）
- [ ] `npm run validate` が green

## テスト戦略

- 単体: 既存の stale チェックで動作不変を確認。新規テストは不要（コメントのみ）。

## 見積もり

0.25 SP

## Definition of Done

- [ ] 全BDDシナリオが検証されパスする（既存テストで動作不変を確認）
- [ ] type-check / lint / test が通る（`npm run validate` green）
- [ ] 検証結果（コマンドと結果）を PBI に記録する
- [ ] コードレビュー完了
