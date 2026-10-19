# 2026-10-20 backlog: code-review・簡素化パス由来の発見（6件）

2026-10-20 の code-simplifier パス（ブランチ 1020a、src/ 全体簡素化 29 ファイル + 新規 1 ファイル）と、その差分に対する code-review で出た「Suggestions 3 件 + 未適用発見のうち PBI 化対象 3 件」を RICE 採点して PBI 化した。**confirmed 6 件 / rejected 2 件**。

rejected（意図的判断として PBI 化せず）:

| 対象 | 理由 |
|---|---|
| `src/utils/storage/encryptionSession.ts:274-298` session-rescue ブロックの統合 | durability 優先の意図的差分（コメント記載済み）。`migrateLegacySecretToEnvelope` と重複して見えるが no-KEK 時の永続化と mismatch 時の裁定が異なるため、統一は挙動リスクがある |
| `src/utils/storage/privacyConsent.ts:375` docListener ラッパの削除 | 冗長に見えるが、listener 直渡しでは 2 つの subscribe 呼び出しが addEventListener の重複排除で 1 登録に潰れるため、subscribe 1 回につき 1 登録を保証するラッパが必須 |

## RICE 採点

前提: 全候補 非機能追加（開発者・保守担当者向け）。Reach は 期間あたりの開発者タッチ・影響コードパス、Impact は 3=圧倒的 / 2=大きい / 1=中 / 0.5=小 / 0.25=極小、Confidence は 推定への確信度、Effort は 人日。

| 順位 | 候補 | Reach | Impact | Confidence | Effort | RICE | SP | PBI |
|---:|---|---:|---:|---:|---:|---:|---:|---|
| 1 | UPDATABLE_FIELDS fail-closed 化 | 40 | 2 | 80% | 0.5 | 128 | 1.0 | [2026-10-20-01-fix-updatable-fields-fail-closed.md](2026-10-20-01-fix-updatable-fields-fail-closed.md) |
| 2 | isOverImportSizeCap の命名 | 20 | 0.5 | 80% | 0.1 | 80 | 0.1 | [2026-10-20-02-fix-import-size-cap-naming.md](2026-10-20-02-fix-import-size-cap-naming.md) |
| 3 | saveSavedUrlEntryMetadata 単一走査化 | 60 | 0.25 | 80% | 0.2 | 60 | 0.3 | [2026-10-20-03-fix-saved-url-metadata-single-pass.md](2026-10-20-03-fix-saved-url-metadata-single-pass.md) |
| 4 | wasm ラッパ .d.ts の any 排除 | 30 | 1 | 80% | 1.0 | 24 | 2.0 | [2026-10-20-04-fix-wasm-dts-any-elimination.md](2026-10-20-04-fix-wasm-dts-any-elimination.md) |
| 5 | asRecord / isPlainRecord 統合 | 15 | 0.5 | 80% | 0.3 | 20 | 0.5 | [2026-10-20-05-fix-plain-record-guard-merge.md](2026-10-20-05-fix-plain-record-guard-merge.md) |
| 6 | background 高複雑度関数の分割 | 50 | 1 | 50% | 3.0 | 8.3 | 5.0 | [2026-10-20-06-fix-background-complexity-refactor.md](2026-10-20-06-fix-background-complexity-refactor.md) |

実行順（依存なし）: 01 → 02 → 03 → 04 → 05 → 06。02・03 は同一日中の軽微な修正としてまとめて着手してよい（ファイルが重ならないため並列可）。06 は工数最大のため単独セッション推奨。

## 採点の根拠

- **順位 1（UPDATABLE_FIELDS）**: 履歴書き換えを黙って許す fail-open を防ぐデータ整合性の防御。Impact=2（来歴列の silent UPDATE 許可）に対し工数はテスト pin 追加のみ
- **順位 2・3（命名・走査）**: 効果は小さい（Impact=0.5 / 0.25）が Effort が極小で、2026-10-20 の簡素化で導入された指摘の閉じ
- **順位 4（wasm d.ts）**: PII サニタイザという privacy の要の型境界。ただし呼び出し側の波及確認に Effort が掛かる
- **順位 5（ガード統合）**: 同一条件の確認済み重複。影響は保守性のみ
- **順位 6（複雑度分割）**: 効果が確率的で Confidence=50%、Effort=3.0。high-risk 領域だが相対比較で最後

## 出典

- code-review（2026-10-20）Suggestions 1-3
- code-simplifier パス（2026-10-20、ブランチ 1020a）未適用発見（wasm d.ts の any、background 高複雑度）
- サブエージェント報告（storage util 簡素化）未適用発見 8（asRecord / isPlainRecord）
