# バックログ: arch-delivery-loop 0921 (2026-09-21)

holistic-0921 + closer の21 PBI 完了後の第2回 arch-delivery-loop。3クラスタ診断（WASM / 永続化 / 録画パイプライン+コンテンツ抽出）→ 12候補 → RICE 採点 → 9 PBI 化（NN 17-25）+ 台帳送り3件。確認なしで Phase 2（実装）→ Phase 3（make clean test-full ゲート）→ Phase 4（版上げ）まで閉じる。HTML レポート: `$TMPDIR/architecture-review-1789987425.html`。

## 採点

共通前提: Reach = 影響するコールサイト数 / Impact = 3圧倒的・2大・1中・0.5小 / Confidence = 100/80/50% / Effort = 人週。

| 順位 | PBI | 候補 | Reach | Impact | Conf | Effort | RICE |
|---|---|---|---|---|---|---|---|
| 1 | [2026-09-21-17](2026-09-21-17-refactor-pipeline-text-selector.md) | R1 要約ソース優先順位の selector 単一所有 | 8 | 2 | 1.0 | 0.5 | **32** |
| 2 | [2026-09-21-18](2026-09-21-18-refactor-wasm-crate-manifest.md) | W1 WASM crate manifest SSOT | 8 | 2 | 1.0 | 0.5 | **32** |
| 3 | [2026-09-21-19](2026-09-21-19-refactor-tagcooccur-fallback-runtime.md) | W2 tagCooccur fallback+guard を runtime へ | 6 | 1 | 1.0 | 0.25 | **24** |
| 4 | [2026-09-21-20](2026-09-21-20-refactor-dashboard-read-policy-seam.md) | P1 dashboard 読み取り pre-clamp 解消 | 6 | 2 | 1.0 | 0.5 | **24** |
| 5 | [2026-09-21-21](2026-09-21-21-refactor-recording-skip-decisions.md) | R2 skip 判定の seam 合流 | 5 | 1 | 1.0 | 0.25 | **20** |
| 6 | [2026-09-21-22](2026-09-21-22-refactor-node-wasm-test-loader.md) | W4 Node WASM ロード helper | 4 | 1 | 1.0 | 0.25 | **16** |
| 7 | [2026-09-21-23](2026-09-21-23-refactor-opfs-search-skeleton.md) | P2 検索実行スケルトン骨格統一 | 5 | 1 | 1.0 | 0.5 | **10** |
| 8 | [2026-09-21-24](2026-09-21-24-refactor-js-whitespace-set-ssot.md) | W3 JS whitespace 集合 SSOT | 3 | 2 | 0.8 | 0.5 | **9.6** |
| 9 | [2026-09-21-25](2026-09-21-25-refactor-contentkernel-extract-commit.md) | R3 contentKernel extract+commit | 4 | 1 | 0.8 | 0.5 | **6.4** |

## 実行順の逸脱理由

- 順位1 R1 = 2 W1 同点 (32): W1 を先 — STAGED drift（dedup public 未出荷）が実害の実績であり、24 で wasm-pack 再構築を含む以降の wasm 作業の土台になる
- 3位 W2 = 4位 P1 同点 (24): W2 先（同点 tie-break のリスク軽減: mechanism/policy 配置違反は runtime 契約そのものの劣化）
- 依存: 21 は 17 と extractSentencesStep.ts を共有 → 17 の後。24 は wasm-pack 再構築（3クレート）を伴うため直列最終。バッチ: A = 17/18/19/20（並列）→ B = 21/22/23/25（並列）→ C = 24（直列）

## 台帳送り（実害未発生・再検討トリガー付き）

- **P3: 2 wire table の dashboard-hop codec 形状統合**（interface 抽出のみ deletion test passes）— トリガー: 2 wire table を同時に改修する時
- **P4: ensureBackend/getBackend の resolver 入力 literal**（trivial サイズ）— トリガー: backend 状態 field の追加時
- **R4: checkPrivacyHeadersStep の force/whitelist 短絡+pending 組み立て残余**（allow 短絡は privacyInfo fetch 回避の意図的 I/O 最適化を含む）— トリガー: privacy step 次回改修時

## なぜなぜ要約

- 「21 PBI 閉じた直後になぜ12候補出るか」→ (a) 直近ラウンドの新コード（wasmHybridRuntime・sqliteWireTable・recordingDecision・js-strings）が新たな深い seam を生み、その外側に残る浅いモジュールが相対化された (b) md-sanitize 削除済み前提の修正（診断が正した）(c) test/bench インフラは深ening ラウンドの対象外だった
- 「W1 の4重所有が残ったか」→ crate ごとの wasm-pack 追加が個別のホットフィックスで行われ、リスト更新が4ファイルにばら撒かれた。STAGED（dedup 未出荷）状態の伝達が prose NOTE だったため機械検査不能
- 「R1 が visitPayload と同型まで再発したか」→ ExtractResult が 20超 optional field の受動的な袋で、選択責任を誰も所有していなかった。型は存在するが interface（呼び出し側が知るべき優先順位）を含んでいなかった

## 実行結果（2026-09-21 完了）

- **全9件 実装・検証・コミット・アーカイブ完了。** バッチA（17/18/19/20 並列）→ バッチB（21/22/23/25 並列）→ バッチC（24 直列・Rust）
- コミット: 17 9e3bf74 / 18 bb37635 / 19 706eeb6 / 20 d7d4c4c / 21 fd868b0 / 22 5a2c4a1 / 23 cc61e97 / 25 2e30490+1df8994 / 24 8aef932
- 実装中の発見: (a) PBI 20 — fts 既定 50 が background clamp 専有で offscreen planner は再現していなかった（単純削除で既定 50→100 の挙動変化）→ planSearch に DEFAULT_SEARCH_LIMIT=50 を移植し SQLITE_SEARCH 直送路とも既定を統一 (b) PBI 22 — 診断の「~8重複」実数は10サイト（bench 4本・parity 4本・wasm-success 2本）(c) PBI 23 の検証で offscreen-search-orderby pin が PBI 20 の意図的変更（100→50）で RED → pin 更新 (d) PBI 17 — selector 配置は background/pipeline（contentExtractor 配置は utils→background 逆辺を生むと実証）(e) PBI 25 — extractor.ts facade は禁止ファイルだったため統合側が deep call 優先配線に移行
- 統合検証（Phase 3）と版上げ（Phase 4）は台帳の各セクションに追記
