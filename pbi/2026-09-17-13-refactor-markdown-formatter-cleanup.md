# PBI: markdownFormatter の表面清掃 — 死んだ export 削除 + 形式明示命名

優先度: 順位 3 / 4（RICE: 6.0 = Reach 6 / Impact 0.5 / Confidence 1.0 / Effort 0.5 pt。全候補5件中4位・1位は台帳清掃）
backlog: [2026-09-17-00-backlog-arch-review-0917b.md](2026-09-17-00-backlog-arch-review-0917b.md)（台帳）
依存: なし

## ユーザーストーリー
拡張機能を保守する開発者として、`src/utils/markdownFormatter.ts` の死んだ export を削除し、生存関数の名前から出力形式が分かるようにしてほしい、なぜなら名前から形式が推測できない状態では読み手が誤った関数を掴み、使われていない関数がいつまでも残って発見しづらさを生むから。

---

## 背景（現状と課題）
`src/utils/markdownFormatter.ts` はサニタイズ列の SSOT であり、実装済み PBI（archived 2026-09-17-04）の SSOT 統合は完了している。残っているのは表面の清掃である。該当箇所はいずれも実在を確認済みである（以下、行番号ではなく関数名と概略位置で示す）。

1. `formatEntriesToGenericMarkdown`（`src/utils/markdownFormatter.ts` 内の公開関数。heading 形式を `---` で連結する） — 本番呼び出し元ゼロである。読み取りで確認した限り、参照は `src/utils/__tests__/markdownFormatter.test.ts` のテストのみであり、本番コードからの参照はない。SSOT 統合後に利用者が消えた死んだ export である。
2. `formatEntryToMarkdown`（`src/utils/markdownFormatter.ts` 内の公開関数。heading 形式1件を生成する。`src/utils/copyMarkdownButton.ts` のクリックハンドラ付近から使用されている） — 名前からは heading 形式であることが分からない。
3. `formatEntriesToMarkdown`（`src/utils/markdownFormatter.ts` 内の公開関数。obsidianList 形式の連結を生成する。`src/background/handlers/dashboardSqlite/` 配下の `deps.ts` の import・注入経由で append 系ハンドラから使用され、`src/dashboard/obsidianFormatter.ts` が re-export している） — 名前からは obsidianList 形式であることが分からず、上記 2 と単複の違いしかない。

影響: 「Generic」という名前の死んだ関数が残っていることで、どれが現役の形式か判断しづらい。新規の呼び出し元が死んだ関数を掴む、あるいは逆に必要な関数を見つけられない恐れがある。ただし本 PBI は挙動変更を含まない清掃であり、サニタイズ列・出力内容には一切触れない。

対応方針: (a) `formatEntriesToGenericMarkdown` を削除する（利用を復活させる意図があるなら接続して活性化する。どちらかを判断ポイントとして着手時に明記すること）(b) 生存関数を形式明示名へ改名する（例: `formatEntryToMarkdown` → `formatEntryToHeadingMarkdown`、`formatEntriesToMarkdown` → `formatEntriesToObsidianList`）。改名は呼び出し元更新を含む（`copyMarkdownButton.ts`、`dashboardSqlite` 関連の `deps.ts` 経由など。着手時に grep で全呼び出し元を確定すること）(c) 出力は byte-identical とする（rename のみで挙動変更なし）。

制約: `markdownFormatter.ts` はサニタイズ列の SSOT であり、今回触るのは export 名と死んだ関数のみとする。`buildEntryMarkdown` 本体・parity テストは無変更で green を維持する。

---

## BDD受け入れシナリオ
```gherkin
Scenario: 改名前後で生成 Markdown が byte-identical である（回帰 pin）
  Given 改名後の関数群（heading 形式・obsidianList 連結）が存在する状態
  When  呼び出し元を改名後の関数に更新する
  Then  同一入力に対する生成 Markdown が改名前と byte-identical である（既存 parity/golden テスト無変更 green）

Scenario: 空配列は obsidianList 連結で空文字を返す（境界）
  Given 空配列の入力が存在する状態
  When  obsidianList 連結で Markdown を生成する
  Then  空文字を返す（既存契約の pin）
```

## 受け入れ基準
- [ ] `formatEntriesToGenericMarkdown` が削除されている（または利用を復活させる意図がある場合は接続して活性化されており、どちらを選んだか判断理由が記録されている）
- [ ] 生存関数が形式明示名へ改名されている（heading 形式・obsidianList 連結が名前から分かる）
- [ ] 改名に伴う全呼び出し元が更新されている（着手時の grep で確定した全箇所）
- [ ] 同一入力に対する生成 Markdown が改名前と byte-identical である（既存 parity/golden テスト無変更 green）
- [ ] 本 PBI による挙動変更がない（rename のみ。出力差分ゼロ）
- [ ] 既存テスト（`markdownFormatter.test.ts`／`markdownJoinSafety.test.ts`／dashboardSqlite の append 系ハンドラ）が green のままである
- [ ] `npm run type-check`／`npm run lint`／`npm test` が green である

## テスト戦略
- 回帰 pin: 既存 parity/golden テスト（`markdownJoinSafety.test.ts` の parity 記述群）を無変更のまま green に保ち、改名だけでは出力が変わらないことを証明する。テスト自体の期待値は書き換えない
- 境界 pin: 空配列に対する obsidianList 連結の空文字契約を、既存テストの観点でそのまま pin する（新規テストを書く場合は既存契約と同一期待値にする）
- 既存スイートの維持: `markdownFormatter.test.ts`（改名に伴う import 更新を除く期待値は不変）、`copyMarkdownButton` 系テスト、dashboardSqlite append 系ハンドラのテストを green のまま保つ

## 見積もり
0.5 pt（ヘッダの RICE Effort と一致）。範囲は死んだ export 1件の削除と生存関数2件の改名＋呼び出し元更新であり、新規挙動の追加はない。

## 実装ガイド

### 判断ポイント（着手時に明記）
- `formatEntriesToGenericMarkdown`（heading 形式の `---` 連結）を削除するか、どこかに接続して活性化するか。読み取りで確認した限り本番呼び出し元はゼロのため、既定は削除である。活性化を選ぶ場合は接続先と理由を記録すること。

### 改名案（例）
| 現行名（関数名＋概略位置） | 改名案 | 形式 |
|---|---|---|
| `formatEntryToMarkdown`（`markdownFormatter.ts`。`copyMarkdownButton.ts` が使用） | `formatEntryToHeadingMarkdown` | heading 形式1件 |
| `formatEntriesToMarkdown`（`markdownFormatter.ts`。`deps.ts` の注入経由で append 系ハンドラが使用） | `formatEntriesToObsidianList` | obsidianList 形式の連結 |

### 着手時の注意
- 着手時に grep で全呼び出し元を確定すること。読み取りで確認した限り、少なくとも `copyMarkdownButton.ts`、`dashboardSqlite` 配下の `deps.ts` の import・注入・ハンドラ使用箇所、`obsidianFormatter.ts` の re-export、parity テスト・単体テストの import が対象になる。
- `buildEntryMarkdown` 本体と parity テストの期待値は無変更とすること。変えるのは export 名・import・呼び出し名・死んだ関数の削除のみである。
- 確認ポイント: `src/utils/markdownFormatter.ts`、`src/utils/__tests__/markdownFormatter.test.ts`、`src/utils/copyMarkdownButton.ts`、`src/background/handlers/dashboardSqlite/` 配下の `formatEntriesToMarkdown` 注入経路、`src/background/__tests__/markdownJoinSafety.test.ts`。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
