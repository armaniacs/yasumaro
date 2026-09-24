# PBI: wasm ship バイナリ再現性リスクの監視契約

**状態: 着手トリガー待ち。現時点では実装しない。**

## ユーザーストーリー

保守者として、wasm の再現性に関する要求や供給網監査に備え、どこまで防御済みで、どこが未防御かを即答できる状態を維持したい。

現在の gate は、fresh rebuild と committed 成果物の行動 parity、ship 対象 3 組の src/public copy の byte 一致を検証する。host を跨いで ship される wasm バイナリの byte 同一性は保証していない。この防御で十分な間は host-crossing byte equality を必須にせず、監視条件を文書で維持する。

## ビジネス価値

- 供給網監査や再現性要求があった際、防御済みの範囲と未防御のリスクを即答できる。
- 現在の製品契約である行動等価と公開 copy consistency を弱めずに維持できる。
- 再評価が必要な入力変化を検知する基準を提前して定義し、同一 host 内でも成立しない可能性がある binary 再構築の扱いを曖昧にしない。

## 優先度

順位: 26 / 30
RICEスコア: 0.4（Reach=1 / Impact=0.25 / Confidence=80% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 着手トリガー到来前の防御範囲を確認する
  Given 現在の wasm-test は fresh rebuild と committed 成果物の行動 parity を検証している
  And ship 対象 3 組の src/public copy は byte 一致を検証している
  And host path と wasm-bindgen banner により、同じソースでも約 19 byte の差が生じ得る
  When 保守者が現在の防御範囲を確認する
  Then 行動等価と公開 copy の byte 一致が現在の基本契約であることを確認できる
  And host を跨ぐ wasm バイナリの byte 同一性は防御済みではないと確認できる
  And 着手トリガーが到来していない間は実装を変更しない

Scenario: gate 入力が変化したため再評価する
  Given Rust toolchain、Cargo lock、wasm-pack、build/postprocess scripts、manifest の publicShip が gate 入力である
  And 現在の基本契約は行動 parity と 3 組の公開 copy consistency である
  When いずれかの gate 入力に変更が生じる
  Then wasm バイナリ再現性契約を再評価する
  And binary の大きな byte 差分ではなく、parity と公開 copy consistency を基本軸として評価する

Scenario: 供給網監査から byte provenance を求められる
  Given host-crossing byte equality は現在の防御範囲に含まれない
  When 供給網監査または再現性要求が byte provenance を明示的に求める
  Then 再評価トリガーが発火したと判断できる
  And hash manifest と parity の二軸で再現性契約を見直す
```

## 受け入れ基準

- [ ] 本 PBI は着手トリガー待ちであり、トリガー到来まではコード、CI、manifest を変更しない。
- [ ] 現在の基本契約が、fresh と committed の行動 parity、および ship 対象 3 組の src/public byte equality であることを明記する。
- [ ] host を跨ぐ binary byte equality が保証されないこと、同じ host の double build でも path 正規化や banner の差で一致しない可能性があることを明記する。
- [ ] Rust toolchain、Cargo lock、`wasm-pack`、build/postprocess scripts、manifest の `publicShip` を gate 入力として明記する。
- [ ] Rust toolchain、Cargo lock、`wasm-pack`、build/postprocess scripts、ship manifest の変更、および供給網監査による byte provenance 要求を再評価トリガーとして明記する。
- [ ] binary の大きな byte 差分を基本契約にせず、parity と公開 copy consistency を基本軸とすること。
- [ ] build crate 4 件、ship binary 3 件、STAGED の `sentence-dedup`、Rust unit test 対象 5 crate directories、parity suite 7 suite paths、ship byte comparison 3 pairs、glue/dts gate 7 generated paths の現状を混同なく記載する。
- [ ] `release:check` categories に wasm gate がなく、failure 時は 3 fresh binaries を artifact 化而已であること、継続的な byte reproducibility monitor ではないことを明記する。
- [ ] `pbi/2026-09-25-14-refactor-ci-paths-filter.md` 後も `wasm-test` の job が完全保持されることを依存条件として明記する。`pbi/2026-09-25-13-...` は依存先ではない。
- [ ] lockfile または `.npmrc` の変更が `wasm-test` 内の `npm ci` に波及することを明記する。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 本 PBI は監視契約とトリガーの定義までを対象とし、新規 E2E テストは追加しない。
- 着手後に同じ gate を使用する場合は、既存 `wasm-test` の fresh rebuild、fresh と committed の parity、ship 3 組の byte equality、glue/dts stale check、shipped src/public の同一性を外側の受け入れ境界とする。

### 統合テスト

- `wasm/crates.json` と既存 manifest invariant test、build plan test の整合を確認し、build 4 件、lib を加えた unit test 対象 5 件、publicShip 3 件の前提を保つ。
- Rust toolchain、Cargo lock、`wasm-pack`、build/postprocess scripts、`publicShip` の各 gate 入力について、変更時に再評価対象へ分類できることをレビューする。
- CI paths filter 後も `wasm-test` が完全保持されること、および lockfile / `.npmrc` が `npm ci` へ波及することをレビューする。

### 単体テスト

- 本 PBI は継続監視機構と判定ロジックを実装しないため、単体テストは追加しない。
- 将来、監視契約を自動化する場合でも、まず gate 入力とトリガーの分類を単体で検証し、その周辺契約を既存 `wasm-test` で検証する。

## 実装アプローチ

1. 現在の防御を、行動 parity と 3 組の src/public byte equality として定義する。
2. host-crossing byte equality を非防御範囲として定義し、現時点で実害を示す失敗がないという限界を明記する。
3. Rust toolchain、Cargo lock、`wasm-pack`、build/postprocess scripts、ship manifest を gate 入力として列挙する。
4. gate 入力の変更と供給網監査による byte provenance 要求を、再評価トリガーとして定義する。
5. 再評価時は binary diff ではなく parity と公開 copy consistency を基本軸とし、byte provenance が求められた場合は hash manifest と parity の二軸で評価する。
6. 既存の防御、`wasm-test` の完全保持、`npm ci` への波及を侵さないことを受け入れ条件にする。

## 見積もり

0.5 SP（監視契約とトリガーの定義まで）

現時点では着手せず、トリガー到来後の契約定義を対象とする。`wasm-pack` の version pin、継続監視機構、artifact 管理の新設は、この見積もりには含めない。

## 技術的考慮事項

- Rust 1.98.1 は `rust-toolchain.toml` で pin されるが、`wasm-pack` は `cargo install wasm-pack` で latest 実行される。
- binary には host path と wasm-bindgen banner が埋め込まれるため、host を跨ぐ byte 同一性は保証されない。
- 同じ host で double build をしても、path 正規化や banner の差により一致しない可能性がある。
- 現在の gate は fresh と committed の振る舞いを比較し、shipped copy は src/public の同一性だけを byte check する。
- `wasm-test` failure 時の 3 fresh binaries artifact は調査用の出力であり、継続的な byte reproducibility monitor ではない。
- 依存関係は `pbi/2026-09-25-14-refactor-ci-paths-filter.md` であり、paths filter 後も `wasm-test` の完全保持が必要。
- lockfile / `.npmrc` の変更は `wasm-test` 内の `npm ci` に波及するため、gate 入力として扱う。

## 実装者向け注記

### 現状コードの確認

以下は着手条件到来時の確認基準である。

- `.github/workflows/ci.yml:68-161`: `wasm-test` は Rust tests、fresh rebuild、fresh と committed の parity、glue/dts stale check、shipped src/public の同一性を検証する。
- `.github/workflows/ci.yml:105-113`: host path と banner により約 19 byte の差が生じ得ることを gate が明記する。
- `.github/workflows/ci.yml:95-99`: `wasm-pack` は `cargo install wasm-pack` で latest 実行される。
- `scripts/wasm-crates.mjs:317-343`: `checkGate` は committed src/public copy 同士を比較する。
- `rust-toolchain.toml:1-8`: Rust 1.98.1 を pin する。
- `wasm/crates.json:4-75`: build crate は 4 件、ship binary は 3 件、parity suite は 7 suite paths、ship byte comparison は 3 pairs、glue/dts gate は 7 generated paths を定義する。
- `sentence-dedup` は STAGED 1 で、ship binary に含めない。
- Rust unit test 対象は lib-only の `js-strings` を含む 5 crate directories である。
- `scripts/__tests__/wasm-crates.test.ts:101-110`: 4 build / 1 lib / 3 publicShip の manifest invariant を確認する。
- `scripts/__tests__/wasm-build-plan.test.ts:29-99`: build plan を確認する。
- `scripts/release-checks/index.mjs:32-42`: `release:check` categories に wasm gate は含まれない。

### 実装手順

1. 着手トリガーとして、gate 入力の変更または byte provenance 要求を特定する。
2. 現在の防御範囲と未防御範囲を整理する。
3. 採用済みの behavior parity と 3 組の src/public byte equality を維持する前提で、変更が gate 入力へ及んでいるかを確認する。
4. raw binary diff を採用せず、parity と公開 copy consistency を基本軸に再評価する。
5. byte provenance が明示的に要求された場合は、hash manifest と parity の二軸で契約を見直す。
6. CI paths filter の変更がある場合は、`wasm-test` が完全保持されることを確認する。

### 落とし穴

- 同じ host での double buildでも一致すると仮定しないこと。path 正規化と banner の差で不一致になり得る。
- binary の大きな byte 差分を、再現性契約の失敗として扱わないこと。
- 公開 copy の byte equality を弱め、行動 parity だけに置き換えないこと。
- `wasm-pack` の未 pin 状態を、host-crossing byte equality の保証と誤読しないこと。
- 3 fresh binaries の artifact 出力を、継続的な再現性監視とみなさないこと。

## 決定事項

1. **なぜ byte equality がないか**: binary に host path と build provenance banner が埋め込まれるから。
2. **なぜ host 内でも完全固定でない可能性があるか**: `wasm-pack` の version が明示 pin されていないから。
3. **なぜ現状 gate が通るか**: parity suite は fresh と committed の振る舞いを比較し、shipped copy は同一性だけを byte check するから。
4. **それを許容できるのはなぜか**: 現在の製品契約は host を跨ぐ byte equality ではなく行動等価だから。
5. **トリガーは何か**: Rust toolchain、Cargo lock、`wasm-pack`、build/postprocess scripts、ship manifest、供給網監査で byte provenance が要求された時。

## Definition of Done

- [ ] 着手トリガー待ちである旨と、トリガー到来までは実装しない旨を明記している。
- [ ] 現在の防御範囲を、7 suite paths の parity と 3 pairs の src/public byte equality として定義している。
- [ ] host-crossing byte equality と同一 host double build の再現性を防御済みとして扱っていない。
- [ ] すべての gate 入力と再評価トリガーを明記している。
- [ ] binary diff ではなく parity と公開 copy consistency を基本軸としている。
- [ ] byte provenance 要求時には hash manifest と parity の二軸で評価する。
- [ ] manifest、build plan、unit test、stale check の現状と、release check および artifact の限界を記載している。
- [ ] paths filter、lockfile、`.npmrc` に関する依存条件を記載している。
- [ ] 採用済みの behavior parity と 3 組の src/public byte equality を弱めない方針を明記している。
