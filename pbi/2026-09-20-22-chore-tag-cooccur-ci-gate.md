# PBI: CI 同等性ゲートに tag-cooccur を追加する

## ユーザーストーリー

メンテナーとして、tag-cooccur の Rust 変更がコンパイル成果物なしで着陸するのを防ぎたい、なぜなら現状の CI 明示リスト（parity suite・glue/d.ts stale 検査・src/public `cmp`）に tag-cooccur が含まれておらず、Rust ソースだけ更新されてバイナリ・glue が古いままになる回帰を検出できないから

## 優先度

- 順位: 2 / 2（本実装 iteration-2 の残作業）
- RICEスコア: **12.0**（Reach=3 / Impact=1 / Confidence=80% / Effort=0.2週）
- 根拠: PBI-21（配線）より下位の tie-break 的順位。ユーザー可視の価値はなく、回帰防止の守備範囲。ただし `test:wasm`（package.json）経由の Rust 単体ゲートは本実装で自動拡張済みのため、残りは明示リストの追従のみで Effort は小さい
- 依存: なし（PBI-21 とは独立に着手可。`cmp` 部分は PBI-21 完了後に有効化されるが、parity・glue 検査は今すぐ追加できる）

## ビジネス価値

WASM バイナリ・glue の陳腐化を CI で自動検出し、「動かない WASM が配布される」事故を未然に防ぐ。測定方法: 意図的に stale な glue で CI が赤になること

## BDD受け入れシナリオ

```gherkin
Scenario: Rust 変更 without 再ビルドが検出される
  Given wasm/tag-cooccur のソースのみを変更した PR
  When CI の wasm ゲートが走る
  Then parity suite（fresh rebuild 対 committed）が差異を検出して失敗する

Scenario: 正常な PR はゲートを通過する
  Given ソース＋バイナリ＋glue/d.ts を `npm run build:wasm` で同時更新した PR
  When CI の wasm ゲートが走る
  Then parity・glue stale 検査・src/public cmp の全てがパスする

Scenario: 片側コミットが検出される
  Given src/wasm と public/wasm のコピーが不一致の PR（PBI-21 完了後）
  When CI が走る
  Then cmp 検査が失敗する
```

## 受け入れ基準

- [ ] `.github/workflows/ci.yml` の cargo キャッシュパスに `wasm/tag-cooccur/target` が追加される
- [ ] parity suite の明示リストに `src/wasm/tag-cooccur/__tests__/` とハイブリッド wasm-success テスト（`src/dashboard/__tests__/tagCooccurrenceHybrid.wasm-success.test.ts`）が追加される（fresh rebuild 対 committed の両実行）
- [ ] glue/d.ts の stale 検査に `tagCooccurWasm.js` / `tagCooccurWasm.d.ts` が追加される
- [ ] PBI-21 完了後は src/public バイナリ `cmp` 検査に `tag_cooccur_bg.wasm` が追加される（PBI-21 未完了の間は src コピーのみを対象とする旨をコメントで明記）
- [ ] 意図的 stale で赤・正常で緑を確認する

## テスト戦略（t_wadaスタイル・Outside-In）

### E2Eテスト

- 対象外（CI ワークフロー自体の変更。検証は CI 実行結果で行う）

### 統合テスト

- CI 上で fresh rebuild と committed の双方に対する parity suite がパスする
- glue を意図的に旧化させた試行でゲートが赤になる（手動検証）

### 単体テスト

- `npm run test:wasm` が tag-cooccur を含む（本実装で対応済み — 回帰確認のみ）

## 実装アプローチ

- **Outside-In**: CI ゲートの期待結果（赤条件・緑条件）から定義し、ワークフローを更新
- **Red-Green-Refactor**: stale 試行で赤を確認してから正常化
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり

0.2週（要チームでの見積もり）

## 技術的考慮事項

- 依存関係: PBI-21 とは独立。`cmp` 検査の有効化だけ PBI-21 完了が前提（それまではコメントで段階明示）
- テスタビリティ: ワークフロー変更の検証は CI 実行か `act` 等のローカル再現
- 非機能要件: CI 時間の増加は parity 追加分のみ（数十秒規模）
- 制約: 本実装タスクの repo 変更限定（`.github/` 不可）のため PBI 化した経緯がある — 本 PBI で制約は解除される

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること）

```bash
# 機能に関連するキーワードでコードを探す
grep -rn "sentence-dedup\|sentence_dedup" .github/workflows/ci.yml
```

sentence-dedup 用の行が tag-cooccur 追加の雛形。各箇所（キャッシュ・Rust テスト・parity リスト・glue 検査・cmp 検査）に sentence-dedup と対称な行を追加する。

### 実装手順

1. `cache` の path に `wasm/tag-cooccur/target` を追加する
2. parity 実行行（fresh / committed の2箇所）に `src/wasm/tag-cooccur/__tests__/` と `src/dashboard/__tests__/tagCooccurrenceHybrid.wasm-success.test.ts` を追加する
3. `git diff --exit-code` 検査に `src/wasm/tag-cooccur/tagCooccurWasm.js` と `tagCooccurWasm.d.ts` を追加する
4. PBI-21 の状態に応じて `cmp` 検査を追加する（未完了なら src のみ対象の旨をコメント）
5. stale 試行で赤→正常で緑を確認する

### 落とし穴

- ホスト間バイト比較は不可（panic パス・wasm-bindgen バナーの差異 — ci.yml 内コメント参照）。behavioral equivalence（parity 両実行）+ 同一ホスト内 `cmp` の構成を崩さないこと
- `npm run build:wasm` は tag-cooccur の public コピーを行わない（STAGED のため）。PBI-21 で public コピー運用が決まったら build:wasm の更新要否も再確認する

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [ ] リファクタリング完了（グリーン後）
- [ ] ロールバック手段の検討（ワークフロー変更の revert で旧ゲートに戻る）
- [ ] ドキュメント更新済み
