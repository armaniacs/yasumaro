# PBI: タグ共起集計を Rust/WASM に移植する

## ユーザーストーリー

ダッシュボード利用者として、タグクラスタパネルを履歴が1万件規模でも固まらずに開きたい、なぜなら現状の `computeTagCooccurrence` は 10k×20tags で約270ms UI スレッドを塞ぎ、パネル表示のたびに体感できる引っかかりになるから

## 優先度

- 順位: 1 / 4（本計画の P1）
- RICEスコア: 8.0（Reach=5 / Impact=3 / Confidence=80% / Effort=1.5週）
- 根拠: 実測 5k×12tags ≈ 50ms、10k×20tags ≈ 267ms（初回発見時の実測プローブ、Node v26.7.0。実装後の本番経路実測は `src/wasm/tag-cooccur/bench.ts` と `pbi/00-INDEX.md` 参照）。c8 前例（TS 3.46ms→WASM 1.18ms、約2.9x、ヒープ 17MB→0.18MB）から同系統の Map/Set＋ペア走査は WASM で勝てる見込みが強い。Reach を 5 に抑えたのはタグパネル利用者に限定されるため。倍率の保証はしない（プローブは TS 単体の絶対値）

## ビジネス価値

タグクラスタ表示のインタラクティブ性が履歴規模に依存しなくなる。ペア走査の GC 負荷（`Map<string,number>` の文字列キー大量生成）を WASM 線形メモリ内に閉じ込め、ダッシュボードのロングタスクを削減する

## BDD受け入れシナリオ

```gherkin
Scenario: 大規模履歴でもパネルが固まらない
  Given 10000 件の閲覧履歴（各 20 タグ）
  When タグクラスタパネルを開く
  Then 共起集計が TS 実装より高速に完了し、結果の nodes/edges が TS 実装と完全一致する

Scenario: 小規模履歴は TS のまま速い
  Given 数百エントリ未満の履歴
  When 共起集計を実行する
  Then ハイブリッドのサイズルーティングにより TS パスが使われ、WASM 初期化コストを払わない

Scenario: タグ形式の quirks が保存される
  Given `#tag` 形式・カンマ区切り形式・タグ内 `|` を含む履歴
  When WASM パスで集計する
  Then `#`/カンマ二形式のパース、`key.split('|')` の復元、UTF-16 ソート順が TS 実装と bit 等価である

Scenario: 上限超過時もコンテンツを落とさない
  Given 1レコードに 50 タグ超を含む履歴
  When 集計する
  Then `MAX_TAGS_PER_RECORD=50` の先頭 N 件採用が TS 実装と同一である
```

## 受け入れ基準

- [x] TS プローブで quirks（`|` 区切り復元、二形式パース、ソート順、上限挙動）を先に固定し、期待値をプローブ結果から書く（予測で書かない）
 [x] 新クレート（仮称 `tag-cooccur`）が既存プロファイル（opt-level 3 / lto / panic=abort）を踏襲する
- [x] 契約は「タグ文字列を1回投入→整数配列（nodeIds/counts/edgePairs/weights）で返却」。O(T²) を WASM 内で完結させる
- [x] ハイブリッドラッパー（既存 `*Hybrid.ts` と同一構造）: 早期リターン → WASM → 例外時 TS フォールバック＋サイズ閾値ルーティング（閾値はベンチ実測で決定）
- [x] パリティテスト（Vitest）: TS vs WASM の等価性を quirks ケース込みで全件検証
- [x] ベンチ（`src/wasm/<crate>/bench.ts`）で TS vs WASM を実測し、不利な数値も含めて報告する
- [x] ビルド配線3箇所（`package.json` / `scripts/postprocess-wasm-glue.mjs` / `wxt.config.ts`）と CI 同等性ゲートへの追加
- [x] `npm run validate` が green（実機確認はユーザー側の旨を報告に明記）

## テスト戦略（t_wadaスタイル・Outside-In）

### E2Eテスト

- 対象外（内部計算の置換。パネル表示の回帰は既存タグクラスタパネルテストがカバー）

### 統合テスト

- ハイブリッド経由の大入力ケース（小入力だとサイズルーティングで TS 経由になり検証が無意味化するため、大入力を必ず含める — lessons-learned）
- WASM 初期化失敗時の TS フォールバック

### 単体テスト

- Rust クレート内単体テスト（`cargo test`）: ペア列挙、空集合、重複タグ、上限クリップ
- TS パリティスイート（gate）

## 実装アプローチ

- **Outside-In TDD**: パネル呼び出しの E2E 期待（表示結果の一致）→ ハイブリッド統合 → Rust コアの Red-Green-Refactor
- 最適化は意味論保持の範囲のみ（FxHash 等のハッシャー差し替えは可、キー定義・ソート順の変更は不可）。最適化後もパリティ全件を再実行

## 見積もり

1.5週（要チームでの見積もり）

## 技術的考慮事項

- 依存関係: なし。ダッシュボード拡張ページは `extension_pages` に `wasm-unsafe-eval` 済み（`wxt.config.ts:215`）
- 遵守すべき ADR: 既存3クレートのハイブリッド構造・初期化（`initWasm.ts`）の踏襲
- 非機能要件: 上限化の二重価値（`MAX_TAGS_PER_RECORD` は維持し、WASM 内でも同一クリップ）
