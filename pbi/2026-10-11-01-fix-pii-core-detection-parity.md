# PBI: PII 走査コアの一括是正（Rust email マッチャ・非ASCII チャンクシーム・timeout・ゲート・ベンチ）

- 種別: fix
- RICE: 8.1（R9 × I3 × C0.9 / E3.0）
- 依存: なし（ファイル非重複で並列可。ただし本 PBI は wasm 再ビルドを伴うため、`Cargo.toml` と成果物を触る PBI-09 とは直列。**PBI-01 → PBI-09** の順）
- バッチ: checking-team-1010
- 台帳: `pbi/2026-10-11-00-backlog-checking-team-1010.md`
- 出所: checking-team レビュー（`dev-docs/archived/plans/2026-10-10-2320-review-1007z.md`）High 2件 + Medium 3件

## ユーザーストーリー

プライバシー重視のユーザーとして、日本語ページを含むあらゆる本文で PII が確実にマスクされてほしい。なぜなら現状は (a) 文末ピリオド付きメールが WASM 経路で未マスクのまま保存・クラウド送信され、(b) 日本語本文の 400 バイト境界付近で ASCII PII が丸ごと未検出になり、(c) WASM 経路には時間上限が無く、これらを検出するゲートも存在しないから。

## 背景（現状・証拠）

### H1: Rust `try_email` の非バックトラック（main からの既存バグ、本ブランチの parity 主張が覆えていない）

- `wasm/pii-sanitizer/src/patterns/core5.rs:35-46` — ドメイン部を貪欲に読み切り、`:40` の `rposition` で**最後の** `.` を TLD 境界に固定する。バックトラックしない。
- TS 正典 `src/utils/piiSanitizer.ts:44` の `/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/` はバックトラックして末尾の `.` を捨てられる。
- 本番の成功経路 `src/background/pipeline/piiSanitizeHybrid.ts:139` は WASM 結果を再スキャンせずそのまま返す（`:18-26` が「parity ゲートで等価」と宣言）。
- 実測（System Architect が committed WASM で独立再現、Maintainability Guardian が 400 件のシード fuzz で再現）:
  - `Contact: user@example.com. Thanks`（33文字・**単一チャンク**）→ TS: マスク / WASM: 未マスク
  - `連絡先は user@example.com. まで` → TS: マスク / WASM: 未マスク
  - `user@example.com-based service` → TS: マスク / WASM: 未マスク
  - 400 件 fuzz で乖離 21 件すべてこの型。WASM が余計に検出する方向は 0 件。
  - `git show main:public/wasm/pii_sanitizer_bg.wasm` でも同 3 形状が未マスク = 本ブランチの regression ではない。
- 影響: 文末ピリオド付きメール（英文で頻出）とハイフン連結メールが平文で SQLite 保存・クラウド AI 送信に載る（fail-open）。

### H2: WASM チャンク境界クランプによる非ASCII シームの検出漏れ（本ブランチの regression）

- `wasm/pii-sanitizer/src/lib.rs:142` — `chunk_start = ceil_char_boundary(text, offset)`
- `wasm/pii-sanitizer/src/lib.rs:161` / `:165` — 前チャンク重複スキップを `SCAN_CHUNK_OVERLAP` 相対で判定
- 対照の TS（`src/utils/piiSanitizer.ts:266-281`）は UTF-16 コード単位の `slice` でクランプしない。
- 前チャンクの実カバー終端は `floor(offset+200)`、ガード1の閾値は `ceil(offset)+200` で最大 6 バイトずれる。その窓に入る長さ7以上の ASCII PII は前チャンクに収まらず現チャンクでもスキップされ、どのチャンクでも数えられない。
- 再現（node から出荷 WASM を実行、Compliance & Privacy Guard が実測）:
  - 入力 `'a'.repeat(199)+'あ'+'a'.repeat(192)+' '+'1234567'+' '+'a'.repeat(600)`
  - TS: `maskedItems = ['bankAccount:1234567']` / WASM: `maskedItems = []` で `1234567` が残存
  - 対照（同位置・全ASCII前置き）: TS/WASM ともマスク → 非ASCII シーム固有
  - オーケストレータが UTF-8 バイト配置を検算: チャンク0 = bytes[0,400) に数字は 395-399 の 5 桁しか入らず不成立、チャンク1 = bytes[202,600) では `rel_start 193 + len 7 = 200 <= OVERLAP` でスキップ → 両方で落ちる
- 影響: 既定 `masked_cloud` で未マスク本文がそのままクラウド AI へ送信される。日本語ページは主要ユースケースで 400 バイト境界は頻出。
- 既存ゲートは見逃す: パリティ・コーパス 217 件は「400文字以上かつ非ASCII」が1件のみ。`lib.rs:72` の「境界がずれてもマッチの開始/終了には影響しない」コメントはガード前提を未検証。

### M6: WASM 経路に wall-clock timeout が無い

- 宣言 `wasm/pii-sanitizer/src/lib.rs:125-128`「the WASM core has no timeout concept — the TS wrapper owns time-bounding」
- しかし唯一の本番呼び出し元 `src/background/pipeline/piiSanitizeHybrid.ts:128-173` にも `src/utils/wasmHybridRuntime.ts:124-215` にも deadline 実装が無い（`grep -n "timeout" piiSanitizeHybrid.ts` は doc コメント 1 件のみ）。
- TS 側の実装は `src/utils/piiSanitizer.ts:20,22,303-304`（`DEFAULT_TIMEOUT=5000`、5 マッチごとに判定）。
- `src/wasm/pii-sanitizer/__tests__/parity.test.ts:71-89` が「TS が throw する入力」を skip するため cap/timeout クラスは自動検証の外。

### M16: 跨実装ゲート（パリティ・コーパス）が PBI-16 の chunk 走査を固定できていない

- `src/wasm/pii-sanitizer/__tests__/captured-inputs.ndjson` は本ブランチで未再生成。追加された TS chunk 境界テスト 2 件（長さ 406 / 431 文字）が未収録（実測確認）。
- `SCAN_CHUNK_SIZE` / `SCAN_CHUNK_OVERLAP` / `MAX_MATCH_COUNT` とガード1-4 は TS/Rust 二重定義で、対応関係はコメント（`lib.rs:156-172`）のみ。
- ただし追加 12 件の境界入力では現時点で TS/Rust 出力は完全一致（問題は「未検証」であること自体）。

### M17: 走査ループのブロック構造破壊 + Guard 2 が Guard 1 に完全包含

- `src/utils/piiSanitizer.ts:317-340` — `while` 本体が 12 スペースのまま（新ガード `:270-315` は16スペース）で、読み手には本体がループ外に見える。閉じ括弧は `:340`、`for` の閉じは `:341`。
- `:281` の Guard 2（`match.index === 0 && match[0].length <= OVERLAP`）は `:275` の Guard 1（`match.index + match[0].length <= OVERLAP`）に論理包含され一度も発火しない。Rust 側 `lib.rs:160-165` も同型。両言語で「別々の理由」を示すコメントが付いており、片方だけ直す編集を誘発する。

### M5: 長トークン入力のコストを回帰検知できない

- 実測（Tuning Expert、新旧を同一プロセスで比較）: 60KB 英数ラン WASM 7.12 → 30.39 ms（4.27x）、60KB 数字ラン 13.89 → 38.77 ms（2.79x）、TS フォールバック 11.64 → 86.32 ms（7.41x）。記事テキストは +23%。
- 原因は `step = 400 - 200 = 200` の 50% 重複再走査。**O(n²) 化は無く線形を維持**（k 0.98 → 1.08）。attribution 計測では OVERLAP=0 で -50%、probe 除去は数字ラン -22% のみ。
- `bench/micro/c8-pii-sanitize.bench.mjs:51-81` のフィクスチャは空白区切りの記事本文のため +23% しか出ず、この劣化クラスを検知できない。`docs/PERFORMANCE_TEST.md` の c8 説明も旧実装（サンプリング時代）のまま。

## BDD 受け入れシナリオ

```gherkin
Scenario: 末尾ピリオド付きメールも WASM 経路でマスクされる
  Given 本文が "Contact: user@example.com. Thanks" である
  When WASM コアの sanitizePii を実行する
  Then 出力に "user@example.com" が残らず、TS リファレンスと同じ maskedItems を返す

Scenario: ハイフン連結メールも WASM 経路でマスクされる
  Given 本文が "user@example.com-based service" である
  When WASM コアの sanitizePii を実行する
  Then 出力にメールアドレスが残らない

Scenario: 非ASCII 本文のチャンクシームでも PII がマスクされる
  Given "'a'×199 + 'あ' + 'a'×192 + ' ' + '1234567' + ' ' + 'a'×600" である
  When WASM コアと TS リファレンスをそれぞれ実行する
  Then 双方が bankAccount をマスクし、maskedItems が一致する

Scenario: 走査が時間上限で打ち切られる
  Given 正規表現エンジンを長時間走らせる入力である
  When WASM コアを実行する
  Then TS と同じ上限（DEFAULT_TIMEOUT）で失敗し、部分マスク済みテキストを成功として返さない

Scenario: 長トークン入力のコストがベンチで検知される
  Given 400 文字超の空白なしトークン内部に email/電話を埋めたフィクスチャである
  When bench:micro を実行する
  Then 当該ケースの計測値が記録され、既存 baseline と比較できる
```

## 受け入れ基準

- [ ] Rust `try_email` が右から候補ドットを試し、「末尾ラベルが英字2文字以上」になる最長一致を採る（TS のバックトラック相当）。`user@example.com.` / `user@example.com-based` の 3 形状で TS と WASM の maskedItems が一致する
- [ ] Rust の重複スキップ判定を「前チャンクの実カバー終端（前イテレーションの `chunk_end`）を超えない範囲」基準にする（`prev_chunk_end` 保持）。非ASCII 前置きの再現入力で TS/WASM が一致する
- [ ] `chunk_start` のクランプ規則と重複判定の前提が一致している（クランプで生じた未カバー窓が存在しない）
- [ ] Rust ループ内に TS と同じ 5 マッチごとの deadline 判定を実装する（または呼び出し側で機械的な入力上限として境界を切る）。`lib.rs:125-128` のコメントを実態に合わせる
- [ ] `src/utils/piiSanitizer.ts:317-340` のインデントを1段深くし、ブロック構造を正す
- [ ] Guard 2（TS `:281` / Rust `lib.rs:164-166`）を削除して Guard 1 に一本化する（または包含関係をコメントで明示する。削除する場合は両言語同時）
- [ ] `captured-inputs.ndjson` を再生成し、追加した chunk 境界テスト 2 件と本 PBI の回帰入力を収録する
- [ ] チャンク境界を跨ぐ入力（境界±20文字に PII を置く数件、非ASCII パディングを含む）を跨実装の固定コーパスとして追加し、TS/Rust の出力一致を直接 assert する
- [ ] `npm run build:wasm` で `src/wasm/pii-sanitizer/pii_sanitizer_bg.wasm` と `public/wasm/pii_sanitizer_bg.wasm` を再生成し、両者が byte 一致する（`npm run test:wasm` / `node scripts/wasm-crates.mjs check`）
- [ ] `bench/micro/c8-pii-sanitize.bench.mjs` に「400文字超の空白なしトークン内部に email/電話を埋めた」フィクスチャを追加する（マッチ数は `MAX_MATCH_COUNT=1000` 未満に抑える）。baseline を更新し `npm run bench:check` の対象にする
- [ ] `docs/PERFORMANCE_TEST.md` の c8 説明と数値を本ブランチの実装で再計測して更新する
- [ ] `npm run validate` が green

## テスト戦略

- unit（TS）: `src/utils/__tests__/piiSanitizer.test.ts` に非ASCII シーム回帰、末尾 `.`/`-` 形状（TS 側は既に green であることを pin）、境界±20 の掃引
- unit（Rust）: `wasm/pii-sanitizer/src/lib.rs` の `#[cfg(test)]` に email 末尾記号・非ASCII シーム・timeout 到達を追加（既存 `masks_email_straddling_a_chunk_boundary` は email のみで `\b` が絶対位置で成立するケースしか見ていない）
- 跨実装: `src/wasm/pii-sanitizer/__tests__/parity.test.ts` + `extended-patterns-parity.test.ts` を再生成コーパスで green にする（現在 277 件）。timeout/cap クラスは skip されているため、skip 理由を明示して対象を分離する
- 性能: `npm run bench:micro`（c8 長トークン・フィクスチャ）で前後を記録
- 回帰: `npm run test:wasm`（Rust 単体 + パリティの CI 経路）

## 見積もり

3.0 SP（Rust マッチャ修正 1.0 + チャンクガード修正 0.5 + timeout 0.5 + コーパス再生成・テスト 0.5 + bench/docs 0.5）

## 技術的考慮事項

- **OVERLAP を上げても本 PBI の H2 は消えない**（`L > 0` で必ず窓が生じる）。定数調整ではなく「前チャンクの実カバー終端」を基準にした判定が必要
- 実装順は `core5.rs`（マッチャ）→ `lib.rs`（ガード + timeout）→ コーパス再生成 → wasm 再ビルド → bench。**wasm 再ビルドは 1 回にまとめる**（本 PBI 内で完結させる）
- `Cargo.toml` と `scripts/build-wasm.mjs` は PBI-09 が触る。本 PBI では strip 工程を追加しない（再ビルド成果物の byte が PBI-09 で変わるため直列にする）
- Red Team が報告した「長さ200未満の PII が継ぎ目で丸ごと落ちる」は System Architect の裁定で**棄却**されている（幾何: `L ≤ 200` のマッチは開始位置を含むチャンクに必ず完全包含。実測 sweep で未マスク 0 件）。提示例はパディング `'z'` が単語文字で `\b` が消えるだけ。本 PBI の H2 とは別事象なので混同しないこと
- `\b` 前提により「非単語文字に直接隣接する IBAN」が両実装で未検出になる点はパターン設計の受容判断であり、本 PBI のスコープ外（台帳送り）
- マッチ件数上限到達時の UX（記録全体が失敗し理由が見えない）は本 PBI のスコープ外（台帳送り）

## 実装者向け注記

### 実装手順

1. `core5.rs` の `try_email` をバックトラック相当（右から候補ドット、末尾ラベル `[a-zA-Z]{2,}`）に修正
2. `lib.rs` のチャンクループに `prev_chunk_end` を導入し、ガード1/2 の閾値をそれに合わせる
3. `lib.rs` に deadline 判定を追加（`js_sys::Date::now()` を 5 マッチごと）。不要になった `:125-128` のコメントを更新
4. TS 側 `piiSanitizer.ts:317-340` のインデント修正、Guard 2 削除
5. Rust 単体テスト + TS テストを追加（Red を確認してから修正）
6. `captured-inputs.ndjson` を再生成（`vitest.capture.config.ts` + `setup-capture.ts` のワンオフ実行）
7. `npm run build:wasm` → `node scripts/wasm-crates.mjs check` → `npm run test:wasm` → パリティ + `src/utils/__tests__/piiSanitizer.test.ts`
8. bench フィクスチャ追加 → `npm run bench:baseline` → `docs/PERFORMANCE_TEST.md` 更新
9. `npm run validate`

### 落とし穴

- ガードの閾値を「チャンク先頭 + OVERLAP」のまま定数だけ動かしても H2 は直らない（クランプで生じた実カバー終端との差が原因）
- コーパス再生成を忘れると、今回追加した回帰が跨実装ゲートの外に残る（M16 の再発）
- TS の期待値変更は「検出改善による正当な変化」か個別に確認する（マスク対象が増える方向の変化は正常）
- `wasm/pii-sanitizer/pkg/` の生成物と `src/wasm` / `public/wasm` の 3 者が一致していることを確認する

## Definition of Done

- [ ] 3 つの email 形状で TS/WASM の maskedItems が一致する（回帰テスト green）
- [ ] 非ASCII シームの再現入力で TS/WASM が一致する（回帰テスト green）
- [ ] WASM 経路の deadline が実装され、コメントとテストが一致する
- [ ] パリティ・コーパスが再生成され、追加回帰が収録されている
- [ ] `npm run validate` / `npm run test:wasm` / `npm run bench:check` が green
- [ ] `src/wasm` と `public/wasm` の pii wasm が byte 一致
- [ ] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする
