# Backlog: code-review 指摘フォロー（review-followup2）

`/code-review`（2026-10-13、コミット 70d9754b〜49ca0c62 対象）の Suggestions 7 件を全件 PBI 化したラウンド。同日番号との衝突はない（2026-10-13 は新規日のため NN01-07 新規採番、NN 昇順＝優先降順）。**✅ 7件完了（2026-10-13 autonomous-task-closer ラウンド3 で実装・アーカイブ済み）**。PBI ファイルは [dev-docs/archived/pbi/](../dev-docs/archived/pbi/) へ移動済み（下表のリンクもアーカイブ先）。

- 入力: code-review レポートの Suggestions 7 件（Critical Issues 0 件・Approve 判定の非ブロッキング指摘）
- 全候補が独立した指摘のため分割・統合なし。NN01 / NN07 はテストコード、NN02-NN06 は検証ゲートと lint ルールのドキュメント・堅牢化

## 実行結果（2026-10-13 ラウンド3）

W1（NN01 / NN02 / NN04 / NN07）はサブエージェント4体で並列実行、W2（NN03 / NN06）はメインで処理（NN06 は Red 確認で pin テストの実効性を実証）、W3（NN05）。全 7 件 `npm run validate` exit 0（1062 files / 16032 tests passed・skipped 0）+ build exit 0。実装中の検証失敗（型債務 463 → 464）は新規 pin テストの配列分割代入が原因でコード修正し 463 に復帰（返済ではなく修正）。実行詳細のまとめは [00-INDEX.md](00-INDEX.md) のアーカイブ履歴「2026-10-13 autonomous-task-closer ラウンド3」を参照。

- **NN01** ― 改変入力 2 パターン → throw を pin（メッセージ断片 `/to deeply equal/` + `toContain` 前提ガード）。設計判断: PBI 基準の「import され」ではなく同ファイル内テスト + de-export（死にエクスポートの完全解消）。Red 確認: ゲート弱体化で Red 側 2 件のみ FAILED・既存テストは green のまま。
- **NN02** ― existsSync + try/catch クリーン fail パターンに統一。実測によるスコープ拡張: クラッシュ点は PBI が挙げた 2 関数ではなく `checkManifestV3Compliance()`(:45) だったため含めた。invalid JSON → exit 1・クリーンメッセージ。dist 復元は checksum 一致で確認。
- **NN03** ― warResourceResolves の対応 2 起源と拡張前提を doc コメントに明記。
- **NN04** ― シャドーイングをリテラル名判定の限界として Limitation 節に併記。
- **NN05** ― `wxt.config.ts` import の規約逸脱理由を import 直上に明記。
- **NN06** ― geturl-extraction-sync.test.ts を新設（ci-paths-filter と同型の pin テスト・dist 依存なし）。Red 確認: 生成物層だけ 1 文字変更 → pin FAILED → 復元 → green。
- **NN07** ― 注入モックを `as Pick<ObsidianClient, 'appendToDailyNote'>` へ寄せる。実契約は後方 2 引数省略可能で 1 引数 vi.fn と互換 → モック側変更不要。

## RICE スコアリング

```
RICE = (Reach × Impact × Confidence) / Effort
Reach: 今後1年の保守・利用での関与頻度（相対 1-10）
Impact: 3=実害解消 / 2=大きい / 1=中 / 0.5=小 / 0.25=極小
Confidence: 1.0=コード・実測で確定 / 0.8=設計判断が残る / 0.5=効果が不確か
Effort: ストーリーポイント
```

| NN | PBI | 種別 | R | I | C | E | RICE | SP | 依存 |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| ✅ 01 | [manifest ゲートの失敗側を pin](../dev-docs/archived/pbi/2026-10-13-01-test-pin-manifest-gate-red-side.md) | test | 3 | 1.5 | 1.0 | 0.25 | **18.0** | 0.25 | なし |
| ✅ 02 | [check-manifest.mjs の JSON パース堅牢化](../dev-docs/archived/pbi/2026-10-13-02-refactor-check-manifest-json-parse-guard.md) | refactor | 2 | 0.5 | 1.0 | 0.25 | **4.0** | 0.25 | なし |
| ✅ 03 | [warResourceResolves の対応起源を明記](../dev-docs/archived/pbi/2026-10-13-03-refactor-war-resource-origins-doc.md) | refactor | 2 | 0.25 | 1.0 | 0.25 | **2.0** | 0.25 | なし |
| ✅ 04 | [no-dead-test-skip のシャドーイング制限を併記](../dev-docs/archived/pbi/2026-10-13-04-refactor-no-dead-test-skip-shadowing-doc.md) | refactor | 2 | 0.25 | 1.0 | 0.25 | **2.0** | 0.25 | なし |
| ✅ 05 | [wxt.config.ts の .ts import 逸脱理由を明記](../dev-docs/archived/pbi/2026-10-13-05-refactor-wxt-config-import-deviation-doc.md) | refactor | 2 | 0.25 | 1.0 | 0.25 | **2.0** | 0.25 | なし |
| ✅ 06 | [getURL 抽出ルールの二層同期を pin](../dev-docs/archived/pbi/2026-10-13-06-refactor-sync-geturl-extraction-layers.md) | refactor | 2 | 0.5 | 0.8 | 0.5 | **1.6** | 0.5 | **NN02 の後**（pin 先の check-manifest.mjs が確定してから） |
| ✅ 07 | [RecordingPipeline モックを実契約型へ寄せる](../dev-docs/archived/pbi/2026-10-13-07-refactor-recording-pipeline-mock-typing.md) | refactor | 2 | 0.25 | 0.8 | 0.25 | **1.6** | 0.25 | なし |

RICE = R × I × C / E。同点（2.0 ×3 / 1.6 ×2）の裁定は「リスク軽減効果 → 時間的緊急性」: NN03（偽 fail の防止）> NN04（保護ツールのドキュメント）> NN05（規約逸脱の注記）、NN06（検証穴のリスク軽減）> NN07（スタイル改善）。

## 実行順（確定）とバッチ計画

| Wave | NN | 内容 | 非重複根拠 |
|---|---|---|---|
| W1 | 01 / 02 / 04 / 07 | ゲート失敗側 pin テスト / JSON パース堅牢化 / シャドーイング併記 / モック型転換 | 4 者ともファイル非重複（manifest.test.ts / check-manifest.mjs / eslint/rules / RecordingPipeline.test.ts） |
| W2 | 03 / 06 | warResourceResolves 起源明記 / getURL 抽出 pin テスト（新規ファイル） | NN06 は新規ファイル、NN03 は manifest.test.ts（W1 の NN01 完了後）。NN06 は NN02 で確定した check-manifest.mjs を pin するため W1 の後 |
| W3 | 05 | wxtConfig import 逸脱理由コメント | NN03 と同ファイル（manifest.test.ts）のため NN03 の後 |

W1 は 4 件並列可。W2 は NN03 と NN06 が並列可。W3 は NN05 のみ。

## 台帳送り（見送り・トリガー管理）

なし（7 件すべて着手可能な指摘。Critical Issues は 0 件で、保留すべきトリガー待ち・ゲート待ちは無い）。

## 共通ファイル（統合側が更新）

- `pbi/00-INDEX.md`、本台帳。
