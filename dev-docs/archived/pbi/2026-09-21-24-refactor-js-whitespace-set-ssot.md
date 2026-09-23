# PBI: JS whitespace 集合定義を3クレート共通の SSOT に単一所有させる

種別: refactor

## ユーザーストーリー

WASM コアを保守する開発者として、JS `\s` の whitespace 集合定義を共有 crate の単一所有に集約してほしい。なぜなら同一の集合が `is_js_ws` と `is_js_space` と `js_ws_len` の3箇所に分散して定義されており、`\s` メンバーの修正が3箇所編集になって漏れると1クレートだけ挙動がズレる drift が起きるから。

## 優先度

- 順位: 8
- RICEスコア: 9.6 (Reach 3 / Impact 2 / Confidence 0.8 / Effort 0.5週)
- 根拠: `\s` 誤りの silent leak クラス防止。集合のズレはコンパイルエラーにならず、1クレートだけ黙って誤判定する故障になるため、集合定義の単一所有化を先に済ませる必要がある。

## ビジネス価値

whitespace 判定の一貫性が3クレート間で構造的に保証され、集合変更時の修正漏れによる挙動ズレが起きなくなる。PII マスキングにおける全角空白や non-breaking space を使った PII の検出漏れは情報漏洩に直結するため、集合の単一所有化は検出品質の土台になる。集合の変更点が1箇所に集まるため、将来の仕様追従時の修正コストと回帰調査のコストが削減される。

## BDD受け入れシナリオ

```gherkin
Scenario: 3エンコーディングの判定が同一集合を返す
  Given JS `\s` の全メンバーと非メンバーからなる検査入力
  When u16 判定と char 判定と byte 幅判定を同一入力に適用する
  Then 3つの判定が全入力に対して同一の真偽を返す

Scenario: 集合定義の変更が全クレートに自動反映される
  Given 集合定義が共有 crate の canonical list のみで定義されている
  When canonical list にメンバーを追加する
  Then tag-cooccur と pii-sanitizer の再ビルドのみで新メンバーが両クレートに反映される
  And 集合定義側の追加編集が1箇所で済む

Scenario: 集合自体は変更されず既存出力と byte 等価である
  Given SSOT 化の前後
  When 既存の cargo test と TS parity を実行する
  Then 全テストがパスし出力に差異が無い
```

## 受け入れ基準

- [x] JS `\s` の canonical list (JS_WS_SCALARS 等) が js-strings の1 module に定義され集合を単一所有している
- [x] tag-cooccur の `is_js_space` が canonical list への委譲になり独自の集合リテラルを持たない
- [x] pii-sanitizer の `js_ws_len` が canonical list 由来の判定を使い独自の集合リテラルを持たない
- [x] 3エンコーディング (u16 テーブル・char マッチ・byte 幅走査) の同一集合返却を検証する三重一致テストが cargo test に追加されている
- [x] 集合自体が変更されていないことが cargo test と TS parity で保証される
- [x] 全3クレート (js-strings・tag-cooccur・pii-sanitizer) が wasm-pack 再構築されバイナリが再コミットされている
- [x] path dependency と rebuild 手順が記録されている

## テスト戦略（t_wadaスタイル・byte等価+三重一致テスト）

Outside-In で進める。まず現行3箇所の判定結果を固定する parity テストと、集合メンバーの byte 等価を固定するテストを先に書く (Red)。次に canonical list を js-strings に置き、2クレートを委譲に置き換えた後も全テストが Green のままであることを確認する (Refactor)。単体では三重一致テスト (u16・char・byte の3判定が JS `\s` 全メンバーと境界外文字に対して同一結果を返すこと) を検証し、統合では既存の TS parity が全件 Green であることを検証する。matching 機構自体は per-encoding のまま留置するため、機構ごとの既存テストはそのまま維持する。

## 実装アプローチ

1. 現行3箇所の判定結果を parity テストとして固定し、集合メンバーの byte 等価 pin を追加する
2. js-strings に canonical list (JS_WS_SCALARS 等) を新設し集合定義を単一所有させる
3. tag-cooccur の `is_js_space` を canonical list への委譲に置き換える (char マッチ機構は留置)
4. pii-sanitizer の `js_ws_len` を canonical list 由来の判定に置き換える (byte 幅走査機構は留置)
5. 三重一致テスト (3エンコーディングが同一集合を返す) を cargo test に追加する
6. 全3クレートを wasm-pack 再構築し、バイナリを再コミットする (src/wasm + public/wasm の慣習は PBI-14 準拠。sentence-dedup の public なし例外に注意)
7. byte 等価 (集合自体は変更しない) を cargo test と TS parity で保証する

## 見積もり

2pt (0.5週)

## 技術的考慮事項

- 集合定義のみ SSOT 化する。matching 機構 (u16 テーブル・char マッチ・byte 幅走査) は本質的に per-encoding なので留置する
- js-strings は3クレート中2つ (textrank・sentence-dedup) が既に path dependency で依存している共有 crate であり、残り2つが依存追加する形になる
- ADR-017 決定8 (クレートはスタンドアロン維持・独立 Cargo.lock) と整合させる。共有 crate への path dependency 追加は PBI-14 前例どおり許容される
- 再構築対象は全3クレート (js-strings・tag-cooccur・pii-sanitizer)。js-strings 自体は共有ライブラリであり、消費者クレートの再ビルドに含めて検証する
- バイナリ再コミットは `npm run build:wasm` の慣習に従い、src/wasm と public/wasm の両コピーを更新する。sentence-dedup のように public コピーを持たない例外があるため対象クレートのコピー先を確認する
- ホスト間バイト比較は不可 (panic パス・wasm-bindgen バナーの差異)。behavioral equivalence (parity 両実行) と同一ホスト内 `cmp` の構成を崩さないこと

## 実装者向け注記

- `wasm/js-strings/src/jsstring.rs:38-52` に `is_js_ws(u16)` がある。UTF-16 単位の判定であり、集合定義の移設先候補である
- `wasm/tag-cooccur/src/cooccur.rs:39-67` に `is_js_space(char)` がある。Unicode scalar の判定であり、doc に JS `\s` と Rust White_Space の相違 (`\u0085` の差異) が記録されている。委譲時は char マッチ機構を残すこと
- `wasm/pii-sanitizer/src/patterns/common.rs:25-50` に `js_ws_len(bytes, pos)` がある。UTF-8 byte 幅対応の判定である。同ファイル 18-24 のコメントが、ASCII のみ受付時の silent leak クラス (全角 U+3000 や U+00A0 で区切られた PII の検出漏れ) を記録している
- `wasm/tag-cooccur/Cargo.toml` と `wasm/pii-sanitizer/Cargo.toml` は js-strings に依存していない。PBI-14 が吸収したのは u16 消費者 (textrank・sentence-dedup) のみであり、本 PBI で残り2つの依存追加を行う
- `wasm/textrank/Cargo.toml:16` と `wasm/sentence-dedup/Cargo.toml:17` の `js-strings = { path = "../js-strings" }` が依存追加の雛形。対称な行を tag-cooccur と pii-sanitizer に追加する
- 故障シナリオ: `\s` メンバー修正が3箇所編集になり、漏れると1クレートだけ挙動がズレる。コンパイルは通るため CI の型検査では検出できず、三重一致テストが検出手段になる
- 再構築手順: `npm run build:wasm` は pii-sanitizer・textrank・sentence-dedup・tag-cooccur を wasm-pack 再構築し、src/wasm と public/wasm (sentence-dedup を除く) にコピーする。js-strings 単体のビルド成果物はなく消費者経由で検証される

## Definition of Done

- [x] 全BDDシナリオが実装されパスしている
- [x] コードレビューが完了している
- [x] 統合検証が green である
