# PBI: レガシー暗号化関数のエクスポート状況を確認し、必要なら完全内部化する

**作成日**: 2026-07-25
**優先度**: Low（調査タスク）
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（フェーズ0調査により既に対応済みの可能性が高い）

---

## 背景

Checking Team レビュー（2026-07-25）の Red Team Leader, Maintainability Guardian, Legacy Bridge Architect（重複）からの指摘。`src/utils/crypto.ts:99-118` の `hashPassword()`（SHA-256ソルトなし）と `verifyPassword()` が `@deprecated` タグ付きでエクスポートされ、`storage.ts` からも再エクスポートされている、という指摘。新規コードでの誤使用リスクがある。

**フェーズ0の事前調査により、この指摘は現状のコードと一致しないことが判明している**（2026-07-25時点）。`src/utils/crypto.ts:93-116` を確認したところ:
- 関数名は `_hashPasswordDeprecated` / `_verifyPasswordDeprecated`（アンダースコア接頭辞）
- `export` キーワードが付いておらず、`/** @internal */` タグが付与されたモジュール内部関数になっている
- `hashPassword` / `verifyPassword` という名前でのエクスポートは crypto.ts に存在しない
- `storage.ts` からの `hashPassword`/`verifyPassword` の再エクスポートも見当たらない

つまり、コンフリクト調整結果に記載された「削除前に使用箇所を特定し移行完了後に削除」という対応は**既に完了している**可能性が高い。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "^export.*hashPassword\|^export.*verifyPassword" src/utils/crypto.ts
grep -rn "hashPassword\b\|verifyPassword\b" src/utils/storage.ts src/utils/storage/*.ts
grep -rln "from.*crypto.js" src/ | xargs grep -n "hashPassword\|verifyPassword" 2>/dev/null
```

コードベース全体で `_hashPasswordDeprecated` / `_verifyPasswordDeprecated` を外部からimportしようとしている箇所がないか（TypeScriptのprivate export制約により通常はできないはずだが念のため）確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: レガシー関数が外部にエクスポートされていないことを確認する
  Given src/utils/crypto.ts の現在の実装
  When crypto.ts の export 一覧を確認する
  Then hashPassword / verifyPassword という名前のエクスポートが存在しない

Scenario: storage.tsからの再エクスポートがないことを確認する
  Given src/utils/storage.ts およびその周辺ファイル
  When レガシー関数の再エクスポートを検索する
  Then 該当箇所が見つからない

Scenario: 調査結果をレビュープロセスにフィードバックする
  Given 指摘が既に解消されていることが確認できた
  When 調査結果をまとめる
  Then plans/2026-07-25-2019-review-main.md に対する誤検出注記を残す
```

## 受け入れ基準
- [ ] `crypto.ts` の全export一覧を確認し、`hashPassword`/`verifyPassword`（deprecated版）が含まれていないことを確認する
- [ ] `storage.ts` およびその他のファイルからの再エクスポートがないことを確認する
- [ ] 確認完了後、本PBIをクローズし、指摘が既に解消済みであることを記録する
- [ ] 万一エクスポートが見つかった場合は、内部関数化（exportの削除）を行う

## テスト戦略

### 単体テスト
- 既存の `crypto.test.ts` が変更されないことを確認（変更が発生した場合のみ）

## 実装アプローチ

1. `grep -n "^export"` で `crypto.ts` の全エクスポートを洗い出す
2. `storage.ts` を含むプロジェクト全体で再エクスポートを検索
3. 見つからなければ調査結果のみ記録してクローズ、見つかれば `export` キーワードを削除

## 見積もり

1pt

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 既存テストで担保

## Definition of Done
- [ ] crypto.tsのexport状況が確認されている
- [ ] 再エクスポートの有無が確認されている
- [ ] 調査結果が記録されている（対応不要 or 追加対応実施）
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Red Team Leader, Maintainability Guardian, Legacy Bridge Architect指摘、現状コードと不一致の可能性あり）
- 対象コード: `src/utils/crypto.ts:93-116`
