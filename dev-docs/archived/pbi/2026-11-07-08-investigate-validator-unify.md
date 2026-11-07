# PBI 2026-11-07-08: validator 重複 isFiniteNumber の意味同一性を裁定する

## ヘッダ

- Rank: 8/9 (holistic improvement round)
- RICE: 0.75 (Reach 3 / Impact 1 / Confidence 0.5 / Effort 2)
- 依存: なし
- 種別: investigate
- 状態: semantic identity UNVERIFIED
- 見積: 2SP

## ユーザーストーリー

開発者として、同名関数 `isFiniteNumber` の二重定義が意味同一かどうかを確定したい。同一であれば片方へ寄せて保守箇所を一つにし、異なれば差分をテストで固定した上で統合可否を判断したい。

## 背景

同名の述語 `isFiniteNumber` が次の二箇所に存在する。

- `src/messaging/sqliteValidators.ts:61`
  - `export function isFiniteNumber(value: unknown): value is number`
  - 本体: `typeof value === 'number' && Number.isFinite(value)`
- `src/messaging/validators.ts:286`
  - `export function isFiniteNumber(v: unknown): v is number`
  - 本体: `typeof v === 'number' && Number.isFinite(v)`

表面的な本体は一致しているように見えるが、意味同一性は UNKNOWN である。本 PBI が裁定する。仮説は次の二択である。

- 仮説 A (同一): 両者は引数名以外同一であり、片方を他方への alias にできる。
- 仮説 B (差異あり): 呼び出し文脈・型ガードの使われ方・将来の分岐予定などにより、安易な統合はできない。

なお、上記の本体引用は本 PBI 作成時に Read で確認した。利用箇所の全体像および変更履歴の確認は本 PBI の調査手順で実施する。

## BDD シナリオ

### シナリオ 1: 両定義の本体と型シグネチャを突き合わせる

```gherkin
Given 同名の isFiniteNumber が 2 箇所に存在する
When src/messaging/sqliteValidators.ts:61 と src/messaging/validators.ts:286 の実装と型ガードを比較する
Then 裁定が記録される
```

### シナリオ 2: 利用箇所と依存方向を調べて統合可否を判断する

```gherkin
Given 両関数の呼び出し箇所の一覧が集まっている
When 循環参照の有無と呼び出し文脈の差異を確認する
Then 裁定が記録される
```

### シナリオ 3: 差異が見つかった場合に差分をテストで固定する

```gherkin
Given 両関数の振る舞いに差異が疑われる入力がある
When 差異を再現する入力例で振る舞いを比較する
Then 裁定が記録される
```

## 受け入れ条件

1. [ ] 同一か否かの裁定が本文または追記に記録されていること。
2. [ ] 裁定の根拠として両ファイルの行番号付き引用が残っていること。
3. [ ] 両関数の呼び出し箇所一覧が証拠として挙げられていること。
4. [ ] 同一の場合、どちらを正本にしてどちらを alias 化するかが指定されていること。
5. [ ] 差異ありの場合、差分を固定するテスト観点が先に定義されていること。
6. [ ] 後続の修正 PBI が起票されるか、統合見送りが理由付きで記録されていること。

## 調査手順 (テスト戦略の代わり)

1. 両定義を Read で再確認し、本体・引数名・戻り値の型ガード・export 形式を表に整理する。
2. リポジトリ内を検索し、各 `isFiniteNumber` の呼び出し箇所を分類する (SQLite 応答検証か、dashboard ゲート述語か、その他か)。
3. 代表的な入力 (`0`, `-0`, `NaN`, `Infinity`, `-Infinity`, 数値文字列 `"1"`, `null`, `undefined`, オブジェクト) に対する振る舞いを両関数で比較し、結果を表に記録する。
4. 両モジュール間の import 関係を確認し、片方への一本化が循環参照を生まないかを判断する。
5. 変更履歴で両定義の導入経緯を追い、意図的な分離かどうかを確認する。
6. 裁定を記録する。同一なら alias 化の方針と正本を示す。差異ありなら差分テストを先に書いた上で統合可否を決め、無理な統合はしない。見送る場合は理由を残す。

## 範囲外

- 本 PBI では実装の統合を行わない。統合は後続の修正 PBI が担当する。
- `isNonNegativeInteger` や `isPositiveInteger` など他の述語の統合は扱わない。

## DoD

- [x] 裁定が記録されている
- [x] 証拠 (行番号付き引用と呼び出し箇所一覧) が残っている
- [x] 後続修正が起票されたか、見送り理由が記録されている
- [x] 日本語本文・英語の code/identifier・Shift-JIS 安全文字のみで書かれている

見送り理由: alias実施は次回ラウンドのmicro-fixに延期する。理由は risk が極小 (re-export 1行・循環なし・既存テストが両モジュールを緑保持) のため、今回のバッチ境界圧力の下で別PBI化するほどではない。トリガー: 次回 holistic ラウンドまたは `src/messaging/` に手を入れる次の変更時。
