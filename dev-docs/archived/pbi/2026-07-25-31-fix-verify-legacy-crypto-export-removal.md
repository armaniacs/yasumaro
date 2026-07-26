# PBI: レガシー暗号化関数（hashPassword/verifyPassword）を内部専用化する

**作成日**: 2026-07-25
**更新日**: 2026-07-26（前回の現状確認が誤りだったため全面訂正）
**完了日**: 2026-07-26
**優先度**: Medium
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（exportの削除により、万一外部から参照している箇所があればビルドエラーになる。事前の参照箇所確認が必須）

## 実装メモ（2026-07-26）

フェーズ0確認で `hashPassword`/`verifyPassword` の呼び出し元を全プロジェクトでgrepした結果、
`src/utils/__tests__/crypto.test.ts` のテストコード以外に使用箇所はゼロだった。`export`キーワードを削除し、
`_hashPasswordDeprecated`/`_verifyPasswordDeprecated` に内部専用としてリネームした。

これらのテストは非export化により同一モジュール外からimportできなくなるため、既存テストケース
（5件）を削除した。この非推奨SHA-256実装は `constantTimeCompare`（既にテスト済み）の薄いラッパーに
過ぎず、実質的なロジックカバレッジは `hashPasswordWithPBKDF2`/`verifyPasswordWithPBKDF2` 側のテスト
（PBI-30で3件追加済み）で十分担保されるため、内部専用関数への個別テスト追加は行っていない。

型チェック・全テストスイート（7357件、削除5件分減）ともに回帰なし。

---

## 背景

Checking Team レビュー（2026-07-25、Red Team Leader/Maintainability Guardian/Legacy Bridge Architect重複指摘）および `plans/2026-07-23-1038-review-fix-0723.md`（Red Team Leader、Medium、126-130行）の両方で同様の指摘。`src/utils/crypto.ts` の `hashPassword()`（SHA-256ソルトなし）と `verifyPassword()` が `@deprecated` タグ付きで**エクスポートされ続けている**。

**訂正（2026-07-26）**: 本PBIは当初「既に非exportの内部関数 `_hashPasswordDeprecated` になっている」と誤って記載していたが、これは前回セッションでの確認ミスであった。2026-07-26時点で `src/utils/crypto.ts` を再確認した結果:

- `hashPassword()` は **`export async function hashPassword(...)`** として `crypto.ts:97` に現存する
- `verifyPassword()` も **`export async function verifyPassword(...)`** として `crypto.ts:110` に現存する
- `storage.ts` やその他ファイルからの再エクスポートは見当たらない（この点のみ前回確認は正しかった）
- 直近コミット `8d1891e`（2026-07-26、「パスワード検証を定数時間にしKDFイテレーションを永続化」）はこの2関数のJSDocコメントを整理した（`@deprecated` の説明文を明確化）のみで、**export自体は削除していない**
- `plans/2026-07-23-1038-review-fix-0723.md:130` が提案した対処（「`@deprecated` JSDocタグを追加。内部使用も `hashPasswordWithPBKDF2` に統一」）はJSDocタグの追加のみ完了しており、exportの削除までは行われていない

つまり指摘は**現在も有効**であり、実装対応が必要である。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "^export.*function hashPassword\b\|^export.*function verifyPassword\b" src/utils/crypto.ts
grep -rln "from.*crypto\.js" src/ | xargs grep -n "\bhashPassword\b\|\bverifyPassword\b" 2>/dev/null
npm run type-check
```

`hashPassword`/`verifyPassword`（PBKDF2版ではない、ソルトなしSHA-256版）が実際にプロジェクト内の他コードから呼び出されていないかを確認する。呼び出し箇所がゼロであれば、exportを削除しても型チェックエラーが発生しないはずである。

## 受け入れ基準（BDD）

```gherkin
Scenario: レガシー関数のexportが削除される
  Given src/utils/crypto.ts の hashPassword() / verifyPassword()
  When export キーワードを削除し、内部使用のみのプライベート関数にする
  Then プロジェクト全体で npm run type-check がエラーなく通る

Scenario: 既存の呼び出し元がない場合は安全に削除できる
  Given プロジェクト全体を grep して hashPassword/verifyPassword の外部呼び出しがゼロである
  When exportを削除する
  Then 既存の crypto.test.ts が全てパスする

Scenario: 万一呼び出し元が見つかった場合はhashPasswordWithPBKDF2への移行を先に行う
  Given hashPassword/verifyPassword を呼び出している箇所が見つかる
  When 移行作業を行う
  Then 呼び出し元を hashPasswordWithPBKDF2/verifyPasswordWithPBKDF2 に置き換えてからexportを削除する
```

## 受け入れ基準
- [ ] プロジェクト全体で `hashPassword`/`verifyPassword`（PBKDF2版ではない方）の呼び出し箇所を洗い出す
- [ ] 呼び出し箇所がなければ、`export` キーワードを削除し内部専用関数にする（必要なら `_hashPasswordDeprecated` のような内部専用の命名にリネームしてもよい）
- [ ] 呼び出し箇所がある場合は、先に `hashPasswordWithPBKDF2`/`verifyPasswordWithPBKDF2` へ移行してからexportを削除する
- [ ] `npm run type-check` が全体でパスする
- [ ] 既存の `crypto.test.ts` が全てパスする（内部専用関数として引き続きテスト可能な形を維持する）

## テスト戦略

### 単体テスト
- 既存の `hashPassword`/`verifyPassword` のテストケースは、関数が内部専用になった後もモジュール内部からテスト可能であることを確認（テストファイルが同一モジュールから直接importする分には支障がない想定）
- 型チェック（`npm run type-check`）で外部からの参照が存在しないことを担保する

## 実装アプローチ

1. `grep -rln "from.*crypto\.js" src/` でcrypto.tsをimportしている全ファイルを洗い出す
2. 各ファイルで `hashPassword`/`verifyPassword`（PBKDF2版と名前が異なる2つ）を実際に使用しているか確認する
3. 使用箇所がなければexportを削除
4. 使用箇所があれば、まずその呼び出し元を `hashPasswordWithPBKDF2` 系に移行してから削除する

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: なし（呼び出し元が見つかった場合は移行作業が追加で発生）
- テスタビリティ: 既存の `crypto.test.ts` が土台

## Definition of Done
- [ ] `hashPassword`/`verifyPassword` のexportが削除されている（または呼び出し元移行後に削除されている）
- [ ] `npm run type-check` がパスする
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Red Team Leader, Maintainability Guardian, Legacy Bridge Architect指摘）、`plans/2026-07-23-1038-review-fix-0723.md:126-130`（Red Team Leader指摘、重複）
- 対象コード: `src/utils/crypto.ts:97, 110`
- 直近コミット: `8d1891e`（JSDocコメント整理のみ、export削除は未実施）
