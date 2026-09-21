# PBI: UTF-16 文字列セマンティクス基盤を共有 Rust crate に抽出する

## ユーザーストーリー
開発者として、JS 文字列セマンティクス(空白表・lowercase・バイグラム・Jaccard)の実装を1箇所に置きたい、なぜなら jsstring/tokenize のクレート間クローンはすでに drift(FxHash 片側移行)が始まっており、片側の修正がもう片側に伝播しないから

## 優先度
- 順位: 3 / 5
- RICEスコア: 3.2（Reach=6 / Impact=1 / Confidence=80% / Effort=1.5週）
- 根拠: SqliteClient alias 化と同点(3.2)。リスク軽減効果の tie-break で上位 — hot 領域(3クレート)の意味論 drift は進行中で、alias 化は純機械的。ADR-017 決定8(スタンドアロン維持・共有基盤抽出は別途)の実行 PBI

## ビジネス価値
「JS 文字列セマンティクスをどうモデルするか」の理解が 2言語・5+ モジュールの往復から1実装+2差分パラメータに減る(navigability)。whitespace/lowercase/bigram の修正が1箇所に集約される(locality)

## BDD受け入れシナリオ

```gherkin
Scenario: 共有基盤が1実装になる
  Given textrank と sentence-dedup の jsstring/tokenize
  When 共有 crate を導入する
  Then whitespace 表・lowercase・bigram window・Jaccard エッジケースは1実装を参照する

Scenario: 意図的差分はパラメータで表現される
  Given trailing-delimiter strip の有無と bigram の case 源(オリジナル vs lowercased)の差分
  When 各クレートがパラメータを指定する
  Then 両クレートの出力は抽出前と byte 等価である

Scenario: 再現ビルドゲートが機能し続ける
  Given 共有 crate 導入後の3クレート
  When cargo test と TS パリティスイートを実行する
  Then すべて green であり、クレート毎の Cargo.lock とバイナリゲートは維持される
```

## 受け入れ基準
- [x] 共有 crate(仮称 js-strings)が新設され、textrank・sentence-dedup が依存する
- [x] 2つの意図的差分(strip の有無・bigram case 源)のみが seam 上のパラメータになる
- [x] クレート毎の tokenizer 単体テストが共有 suite に統約される
- [x] ハッシャ方針(FxHash)が共有 crate で統一され、判断が1箇所に記録される
- [x] 全 cargo test・TS パリティスイート・ci.yml wasm ゲートが green
- [x] pii-sanitizer の js_ws_len(3つ目の whitespace 実装)の取り込み可否を判断し記録する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外(内部構造改善)

### 統合テスト
- 抽出前後での両クレート出力の byte 等価(既存 TS パリティスイートが gate)

### 単体テスト
- 共有 crate の意味論境界(JS `\s` 全メンバー・非BMP・lone surrogate→U+FFFD・Jaccard 空集合規則)

## 実装アプローチ
- **Red-Green-Refactor**: 抽出前に共有 crate の意味論 suite を新設し、クローン側の該当テストを段階的に移設
- 移行順: crate 新設 → textrank 依存切替 → dedup 依存切替 → 意図的差分のパラメータ化 → pii-sanitizer の判断

## 見積もり
3ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし(PBI 13 とは層が違う — Rust 側)。ただし wasm-pack 3クレートのリビルドとバイナリ再コミットを伴う
- 遵守すべき ADR: ADR-017(決定4・8)。本 PBI は決定8の「共有基盤抽出は別途」の実行
- 非機能要件: 再現ビルドゲート(ci.yml wasm-test)の単位を崩さない

## 実装者向け注記

### 現状の証拠
- クローン: `wasm/textrank/src/jsstring.rs`(263行) vs `wasm/sentence-dedup/src/jsstring.rs`(288行) — 差分は doc と split 変種のみで、is_js_ws/is_word_separator/to_lowercase_utf16/contains_japanese は同型
- トークナイザ: 両 `tokenize.rs` — ~60行の同一ループ内に2行の意図的差分(strip 有無・bigram case 源)。`jaccard_similarity` はロジック完全重複
- drift 実績: dedup のみ FxHash(`wasm/sentence-dedup/Cargo.toml` コメント)。textrank は std hasher
- 第3の whitespace 実装: `wasm/pii-sanitizer/src/patterns/common.rs` の `js_ws_len`

## 検証記録 (2026-09-21, worktree yasumaro-wt-pbi14, branch closer/pbi14-js-strings)

- 共有 crate: `wasm/js-strings` (package `js-strings`, sibling と同レイアウト:
  per-crate Cargo.toml + src/ + Cargo.lock)。`jsstring` (空白表・lowercase・
  2 split 変種・Jaccard 前提) と `tokenize` (TokenizeOptions + WordSet +
  jaccard_similarity) を所有。両クレートは path 依存し、自前の
  jsstring.rs/tokenize.rs を削除。
- パラメータ: `TEXTRANK_TOKENIZE` (strip なし・bigram=Lowered)、
  `DEDUP_TOKENIZE` (strip あり・bigram=Original)。seam 上はこの2差分のみ。
- tokenizer 単体テストは共有 suite に統約 (js-strings 27 tests)。
  textrank 22→7、dedup 27→10 (残りは core ロジックのテストで各クレートに残留)。
- ハッシャ方針: FxHash に統一、判断は `wasm/js-strings/src/tokenize.rs` の
  モジュール doc に記録。textrank の std hasher からの切替は出力を変えない
  (jaccard は len/contains/count のみ使用し、両 core は集合の反復順序に
  依存しない)。裏付け: 下記 parity が無変更で green。
- バイナリ再コミット: `src/wasm/textrank/textrank_bg.wasm` +
  `public/wasm/textrank_bg.wasm` (出荷経路: wxt.config.ts publicAssets)、
  `src/wasm/sentence-dedup/sentence_dedup_bg.wasm` (public コピーなし =
  hybrid 未配線 STAGED のため、従来通り)。glue .js/.d.ts は再生成の結果
  byte-identical (binding 変更なし)。
- pii-sanitizer `js_ws_len` 判断: 取り込まない。UTF-8 バイト列上の幅指向
  実装であり、UTF-16 単位上の `is_js_ws` とはドメイン (入力型・返値) が
  異なる。共通化すると変換層が PII hot path に混入するため、空白表の
  一致は目視確認に留め実装は各ドメインに残す。
- ゲート結果: `npm run test:wasm` (js-strings 27 / pii 46 / textrank 7 /
  dedup 10 / tag-cooccur 16) green。TS parity 3 files / 41 tests が抽出前後
  で無変更 green (byte 等価)。ci.yml は cache path に
  `wasm/js-strings/target` を追加し、test step 名を更新 (lock の glob は
  自動追従)。
