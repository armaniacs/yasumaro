# PBI: wa-sqliteのバージョンを明示的にピン留めする

**作成日**: 2026-07-26
**クローズ日**: 2026-07-26（対応不要と判断）
**優先度**: Low
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟡軽微（バージョン固定によりセキュリティパッチの自動取り込みが止まるため、更新運用ルールを定める必要がある）

## クローズメモ（2026-07-26）

`git log -S'"wa-sqlite": "~1.0.0"'` で調査した結果、本PBIが指摘する`~1.0.0`（tildeレンジ）は、
アーカイブ済みPBI `2026-07-18-31-fix-wa-sqlite-exact-version-pin.md` で一度`1.0.0`に完全固定された後、
**別コミット `65a59ee`（2026-07-20、"chore(pbi-18,23): サプライチェーン脆弱性対応とCI/DX改善"）で
意図的に変更されたもの**であることが判明した。同コミットのメッセージに「runtime 依存を ~ 指定に変更し
パッチ自動更新を許可」と明記されており、adm-zipのHIGH脆弱性（GHSA-xcpc-8h2w-3j85）対応と合わせて、
`wa-sqlite`・`@subframe7536/sqlite-wasm`・`bloomfilter`の3パッケージ全体に対する横断的な運用ポリシー
変更だった。

「完全固定に戻すべきか、現状維持すべきか」はユーザーに確認し、なぜなぜ分析の結果、以下の判断で
**現状維持（`~1.0.0`のまま）** に決定した:

- 65a59eeの意図（パッチレベルのセキュリティ修正を自動で取り込む運用）を尊重する
- wa-sqliteだけを例外的に完全固定すると、依存関係ポリシーの一貫性が崩れる
- 「wa-sqliteのパッチが互換性を壊すリスク」は理論上の懸念であり、このプロジェクトで実際に問題が
  起きた実績はない

本PBIは「既に意図的な設計判断が別コミットで行われている」としてクローズし、コード変更は行わない。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Supply Chain & Dependency Sentinel からの指摘。`package.json:76`（現状）で `"wa-sqlite": "~1.0.0"` と、minorバージョンの自動更新を許容する範囲指定になっている。1.x系でも後方互換性が確立されていない可能性があるライブラリのため、意図しないバージョンアップでSQLite操作に影響が出るリスクがある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "wa-sqlite" package.json package-lock.json
```

既存PBI `2026-07-18-31-fix-wa-sqlite-exact-version-pin.md` がアーカイブ済み一覧に存在するため、**同種の対応が既に一度行われている可能性がある**。アーカイブされたPBIの内容を確認し、今回の指摘が別のタイミングでの巻き戻り（`npm install` 等での再度の範囲指定化）でないか確認すること。

## 受け入れ基準（BDD）

```gherkin
Scenario: wa-sqliteのバージョンが厳密固定される
  Given package.json の wa-sqlite が "~1.0.0" になっている
  When バージョン指定を "1.0.0"（範囲指定なし）に変更する
  Then npm install 実行時に意図しないminorバージョンが取り込まれない

Scenario: 既存のビルド・テストが回帰しない
  Given バージョン固定後のpackage.json
  When npm install && npm run build && npm test を実行する
  Then 全て成功する
```

## 受け入れ基準
- [ ] `package.json` の `wa-sqlite` バージョン指定を `~1.0.0` から厳密な `1.0.0` に変更する（または現在インストールされている実バージョンに固定する）
- [ ] アーカイブ済みPBI `2026-07-18-31-fix-wa-sqlite-exact-version-pin.md` との重複がないか確認し、重複があれば本PBIをクローズしてその旨を記録する
- [ ] `npm install` 後、既存のSQLite関連テストが全てパスする

## テスト戦略

### 統合テスト
- `npm run build` と既存のSQLite関連テストスイートを実行し、バージョン固定後も動作が変わらないことを確認

## 実装アプローチ

1. アーカイブ済みPBI `2026-07-18-31-fix-wa-sqlite-exact-version-pin.md` を確認し、重複していないか判断する
2. 重複していなければ `package.json` を修正し `npm install` を再実行
3. ビルド・テストで回帰がないことを確認

## 見積もり

1pt

## 技術的考慮事項
- 依存関係: `package-lock.json` の再生成が必要
- 非機能要件: サプライチェーンセキュリティ

## Definition of Done
- [ ] wa-sqliteのバージョンが厳密固定されている（またはアーカイブ済みPBIとの重複が確認されクローズされている）
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Supply Chain & Dependency Sentinel指摘）
- 関連する可能性のあるアーカイブ済みPBI: `dev-docs/archived/pbi/2026-07-18-31-fix-wa-sqlite-exact-version-pin.md`
- 対象コード: `package.json:76`
