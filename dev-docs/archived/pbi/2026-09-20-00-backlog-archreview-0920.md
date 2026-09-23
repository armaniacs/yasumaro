# バックログ: アーキテクチャレビュー archreview-0920(2026-09-20)

`/improve-codebase-architecture` の探索(サブエージェント ×2: テキスト処理クラスタ / メッセージング・AI プロバイダ領域)で発見した6候補を RICE 採点して PBI 化したもの。候補5は候補3に統合(解が同一箇所=共有 hybrid runtime に宿るため)。レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260920-210621.html`

副産物: `CONTEXT.md`(ドメイン用語集)を新規作成。ADR-017「WASM コアの完全移植 + TS パリティ参照 + ハイブリッドフォールバック戦略」を新規記録(旧候補4に付随していた未整備領域)。

## 採点

共通前提: Reach = 今後30日間に影響するイベント数(ユーザー向け=録画/ダッシュボード利用、開発者向け=当該領域の変更セッション)。Impact = 3/2/1/0.5/0.25。全候補を同一基準・同一期間で比較。

| 順位 | PBI | 候補 | Reach | Impact | Conf | Effort | RICE |
|---|---|---|---|---|---|---|---|
| 1 | [2026-09-20-12](2026-09-20-12-fix-builtin-ai-adapter-contract-unify.md) | 内蔵AI 二重 adapter の契約不一致統一 | 15 | 2 | 0.8 | 0.5 | **48** |
| 2 | [2026-09-20-13](2026-09-20-13-refactor-hybrid-runtime-shared-scaffold.md) | 共有 hybrid runtime(旧候補3+5 統合) | 8 | 1 | 0.8 | 1.0 | **6.4** |
| 3 | [2026-09-20-14](2026-09-20-14-refactor-shared-js-strings-rust-crate.md) | UTF-16 基盤の共有 Rust crate | 6 | 1 | 0.8 | 1.5 | **3.2** |
| 4 | [2026-09-20-15](2026-09-20-15-refactor-sqliteclient-passthrough-alias.md) | SqliteClient パススルー解消 | 2 | 0.5 | 0.8 | 0.25 | **3.2** |
| 5 | [2026-09-20-16](2026-09-20-16-refactor-sqlite-wire-table-extension.md) | 非アーカイブ op の wire table 拡張 | 3 | 1 | 0.8 | 2.0 | **1.2** |

## 根拠と判断

- **順位1（RICE 48）**: 5候補中唯一の現在進行形の user-facing 欠陥(local_only でカスタムプロンプト無言欠落・usage 漏れ)。他4件が将来 drift リスクであるのに対し質が違う。修正は seam を1つに寄せるだけで小さく、学習効果が #13/#14 の設計判断に転用できる。ADR-015 の完成でもある
- **順位2（RICE 6.4）**: 現在3ファイルが動いているため Impact は 1。ただし dedup 本番統合(コミット 0ed11095 の NOTE 4点: publicAssets push・build:wasm cp・ci.yml public cmp・本番呼び出し元)の着手が近く、統合直前に runtime を整えると二度手間が消える。旧候補5(split ゲート所有者不在)は統合で解消
- **順位3（RICE 3.2、順位4と同点）**: drift は実績済み(FxHash 片側移行)。Effort 1.5週で重いが、ADR-017 決定8の実行として価値は確定。tie-break はリスク軽減効果で alias 化を上回る
- **順位4（RICE 3.2）**: 純機械的(deletion test 完全失敗 = 消しても振る舞い不変)。低リスク低利益、空き時間消化向け
- **順位5（RICE 1.2）**: 利益は最大級(16箇所→1行)だが Effort 2週で割れない。**段階適用**(toggle_star を最初の1 op として型を確立 → query/mutate サブセット)で着地。ヘテロ性により全量化が不経済なら ADR 化して再議論を防ぐ

## 依存関係

相互独立。推奨の着手相関: 15 → 16 の順で差分が読みやすい(推奨、非必須)。13 は dedup 本番統合 PBI の直前完了が望ましい。14 は wasm 3クレートのリビルドとバイナリ再コミットを伴うため、13 と同時期に着手するなら CI ゲートの再検証をまとめて行う。

## 疑問の自律解決（なぜなぜ分析の要約）

- 「なぜ RICE 48 が突出するか」→ 効果の質(現在の欠陥 vs 将来の drift)が違い、同列比較の上で着手順に差をつける設計。相対比較の公平性は「同一基準・同一期間」の前提で担保
- 「なぜ wire table 拡張が最下位か」→ 効用/費用が割れないため。段階適用と ADR 化オプションを PBI に明記し、着手時の判断コストを下げた
- 「なぜ hybrid runtime は今か」→ 3ファイルは動いている(現バグなし)ため Impact 1 にとどまる。だが dedup 統合の着手タイミングと重なるため、機会費用の観点で順位2
- 「内蔵AI 統一の修正形状は?」→ (a) adapter を1つに寄せる / (b) 共有 helper 抽出の2案。実装時に design-it-twice で depth 比較する(PBI 12 に記載、この段階での interface 設計はしない)
