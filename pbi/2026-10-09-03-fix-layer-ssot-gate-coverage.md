# レイヤー SSOT ゲートの管轄穴解消（fix）

## 1. タイトル + 種別

- **タイトル**: レイヤー SSOT ゲートの管轄穴解消 — 実在 `@layer` 宣言ファイル群の SSOT 収載 + Barrel stale エントリ除去・filesystem 検査・`@layer` 宣言照合検査の追加（2 候補の統合 PBI）
- **種別**: fix（lint のみの変更 + ドキュメント修正。挙動不変）
- **見積もり**: 2 SP

## 2. 優先度

- **優先度**: 順位 3
- **RICE**: R5 / I2 / C1.0 / E2 → **5.0**
- **根拠**:
  - 前ラウンドで新設した SSOT ゲート自体に管轄穴がある。コード側の `@layer` 宣言を検査するゲートは存在せず、宣言すれば純粋性検査を素通りできる構造。また、ルールリストと LAYERS.md が同じ stale エントリを共有している限り drift 照合は常に pass する — ゲートの検出能力そのものに関わる
  - 保守関与頻度が最大（R5）: `src/utils/` は Wave 単位で新規ファイルが増え続け、ゲートが新規ファイル・宣言を追跡できないと層境界の drift が蓄積する
- **依存**: なし。ただし NN15・NN16 が新規 utils ファイル（`clearElement`・`computeScopeHash` の移設先）を作るため、それらの着地後に統合側が本 PBI で整備した SSOT（LAYER0_FILES / LAYERS.md 分類表）への登録を行うこと（台帳「バッチ計画」節の共通ファイル運用。NN03 のゲートが新規ファイルを追跡するため）

## 3. ユーザーストーリー

**レイヤー構造の保守担当者として**、層境界ゲートがコード側の `@layer` 自己宣言と実在ファイルを追跡していてほしい。なぜなら、宣言すれば素通りできるゲートと、削除済みファイルを現存のように参照し続ける SSOT があると、層境界の純粋性が黙って崩れ、drift が蓄積するから。

## 4. 背景

層境界ゲートは 2 系統で構成される: (1) `local/utils-layer-boundary`（`eslint/rules/utils-layer-boundary.mjs`、error 配線）がルール内のファイルリスト（SSOT）で純粋性を強制し、(2) `npm run lint:layers-docs`（`scripts/lint-layers-docs.mjs`）がルールリストと LAYERS.md 分類表の drift を照合する。本 PBI はこの 2 系統に共通する管轄穴 2 件を解消する。

該当箇所（全 file:line 検証済み）:

### A. `@layer` 自己宣言が SSOT 未収載

- `LAYER0_FILES`（`eslint/rules/utils-layer-boundary.mjs:33-66`）にも LAYERS.md Layer 0 分類表（`dev-docs/LAYERS.md:17-51`）にも収載されていない `@layer` 宣言付きファイルが 12+ 存在する。例:
  - **`@layer 0`**: `src/utils/loopbackPorts.ts:1`（直近ラウンド pbi-1005-06 で新設）・`src/utils/recordingGateTable.ts:1`・`src/utils/listSources.ts:1`・`src/utils/cleansingBadge.ts:1`・`src/utils/registrableDomain.ts:1`
  - **`@layer 2`**: `src/utils/promptSafety.ts:1`・`src/utils/trustDb/TrustLookup.ts:1`・`src/utils/trustDb/TrustDecision.ts:1`
  - **`@layer 1`**: `src/utils/trustDb/TrustDbAdmin.ts:1`・`src/utils/keySerializer.ts:1`・`src/utils/ui/confirmDialog.ts:1`・`src/utils/copyMarkdownButton.ts:1`
- コード側の `@layer` 宣言を検査するゲートは存在せず、宣言すれば純粋性検査を素通りできる構造
- 新規ファイル配置チェックリスト（`dev-docs/LAYERS.md:263-272`、`@layer` 項目は `:271`）は `@layer` コメント付与のみを要求し、LAYER0_FILES / LAYERS.md 分類表への追加ステップが無い。宣言形式は `// @layer N — <purpose>` と `// @layer N` の両方がある（`cleansingBadge.ts:1`・`listSources.ts:1` は後者）
- 根因（台帳 5 Whys）: 配置チェックリストが「@layer コメント付与」のみを要求し、LAYER0_FILES/LAYERS.md への追加ステップが無かったため、宣言が SSOT 外に増えた
- 注記: `// @layer 1` 自己宣言を持つ `src/utils/domainFilter/DomainFilter.ts:1` は `dev-docs/LAYERS.md:250` に既知の未分類（`domainUtils` 経由で Layer 2 に到達）として記載されており、宣言照合検査はこれも検出する。収載先の判断（Layer 2 への分類か検査側の許可リストか）を実装に含めること

### B. Barrel 節が削除済みファイルを参照

- `src/utils/storage.ts`・`src/utils/logger.ts` barrel は削除済みだが、以下に残る:
  - `dev-docs/LAYERS.md:160-161`（「Barrel — Re-export (retired)」節で現存のように記載。storage.ts は「テストのレガシー mock 経路のみが参照」とまで記載）
  - `dev-docs/LAYERS.md:165`（「`storage.ts` への import は lint が警告する」）
  - `dev-docs/LAYERS.md:291`（削除済み storage.ts のファイルヘッダ指定）
  - `eslint/rules/utils-layer-boundary.mjs:116` — `BARREL_MODULES` 3 要素中 2 本が削除済み（`crypto/index.ts` のみ現存）
- `scripts/lint-layers-docs.mjs:116-142` は rule↔docs の双方向照合のみで、filesystem 照合（existsSync）が同ファイル内に皆無 — 両者が同じ stale エントリを持つ限り常に pass する
- 対照的に `scripts/lint-adr-links.mjs` は ADR の Implements パスを existsSync で検証する（`:12`・`:42`）— 同種の検査の既存パターンがリポジトリ内にある
- 補足: `dev-docs/LAYERS.md:283-284`（将来の移行計画）は両 barrel の削除完了を既に記載しており、`:160-161`・`:165`・`:291` は同一ドキュメント内の自己矛盾

## 5. BDD シナリオ

### シナリオ 1: リスト内の全パスが実在する

```gherkin
Given lint-layers-docs.mjs に第 3 の検査（リスト抽出後の全パス existsSync 検証）が追加されている
When ルールリスト・docs 分類表・許可リストのいずれかにリポジトリ内に存在しないパスが含まれる状態で検査を実行する
Then 欠落パスが drift として報告され、非ゼロ終了すること
And 全パスが実在する場合は green であること
```

### シナリオ 2: Barrel SSOT が現存ファイルのみを参照する

```gherkin
Given LAYERS.md の Barrel 節と BARREL_MODULES から削除済み 2 本が除去されている
When npm run lint:layers-docs を実行する
Then Barrel 節は現存する crypto/index.ts のみを収載していること
And rule↔docs の双方向照合と filesystem 検査の両方が green であること
```

### シナリオ 3: `@layer` 宣言が SSOT と一致する

```gherkin
Given src/utils/** の先頭 `@layer` 宣言をパースしてルールリスト/LAYERS.md 分類表と照合する検査が追加されている
When `@layer` 宣言付きファイルが SSOT 未収載のまま存在する
Then 未収載ファイルが報告されること
And 宣言付きファイル群が適切なレイヤーの SSOT に収載された後は green であること
```

## 6. 受け入れ基準

- [ ] `scripts/lint-layers-docs.mjs` に第 3 の検査が追加されている: リスト抽出後に全パスを existsSync で検証し、欠落を drift として報告する（`lint-adr-links.mjs` のパターン準拠）
- [ ] `dev-docs/LAYERS.md` の Barrel 節（`:160-161`・`:165`・`:291`）と `BARREL_MODULES`（`utils-layer-boundary.mjs:116`）から削除済み 2 本（storage.ts・logger.ts）が除去され、`crypto/index.ts` のみが残る
- [ ] 実在する `@layer` 宣言付きファイル群（背景 A の 12+）が適切なレイヤーの SSOT（LAYER0_FILES / LAYER1_FILES / LAYER2_MODULES / LAYERS.md 分類表）に収載されている
- [ ] `src/utils/**` の先頭 `@layer` 宣言をパースしルールリスト/LAYERS.md と照合する検査が追加されている（宣言がゲート入力化される）
- [ ] 収載時に各ファイルの実 import が宣言レイヤーの依存ルールに適合していることを確認している（ルールは error 配線のため、宣言と実依存の不一致は lint 失敗として顕在化する）
- [ ] `npm run lint:layers-docs` が green（双方向照合 + filesystem 検査 + 宣言照合の全検査 pass）
- [ ] `npm run validate` が green（`lint:layers-docs` は validate に配線済みのため、追加検査も validate 経由で走る）
- [ ] 挙動が完全に不変である（production コードの変更なし、lint + ドキュメント修正のみ）

## 7. テスト戦略

1. **lint-layers-docs の実行確認**: `npm run lint:layers-docs` が green。既存の双方向照合に filesystem 検査と `@layer` 宣言照合が追加されて共存して pass すること
2. **負例確認（lint スクリプトのため実行ベース）**: 存在しないパスを一時的にリストへ加えた場合・宣言付きファイルを SSOT 外に置いた場合の双方で、非ゼロ終了と報告内容を確認してから元に戻す
3. **lint ルールへの影響確認**: BARREL_MODULES・各レイヤーリスト変更後に `npm run lint` が green であること。Barrel 除外の意図（二重報告の回避、`utils-layer-boundary.mjs:113-115` のコメント）を維持する
4. **validate green**: `npm run validate`（type-check + test + lint ゲート一式）で全ゲート通過を確認する

## 8. 見積もり

**2 SP** — 検査 2 件の追加（filesystem 照合・`@layer` 宣言照合）と 12+ ファイルの SSOT 収載、stale 除去。1 エントリあたりの変更は機械的だが、宣言レイヤーと実 import の整合確認（背景 A のファイル数 + DomainFilter.ts の判断）を含むため M。影響ファイル: `scripts/lint-layers-docs.mjs`、`eslint/rules/utils-layer-boundary.mjs`、`dev-docs/LAYERS.md`（+ 必要に応じて `DOCS_ONLY_ALLOWLIST`）

## 9. DoD

- [ ] 受け入れ基準 8 件すべて充足
- [ ] `npm run validate`（type-check + test + lint ゲート一式、`lint:layers-docs` 配線済み）が green
- [ ] 追加検査の負例確認済み（欠落パス・未収載宣言が非ゼロ終了で報告される）
- [ ] LAYERS.md に削除済み barrel（storage.ts / logger.ts）への現存前提の記述が残っていない（grep で確認）
- [ ] `src/utils/**` の先頭 `@layer` 宣言付きファイルがすべて SSOT 収載または検査側の許可リスト化されており、宣言がゲート入力として機能している
- [ ] production コードの挙動不変（lint + ドキュメント修正のみ）

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 3（R5 / I2 / C1.0 / E2 → 5.0）。台帳の主な構造的課題 (3)「ラウンドで新設した SSOT ゲート自体の管轄穴（@layer 未収載・filesystem 照合欠落）」に対応
- 依存: なし。NN15・NN16 の新規 utils ファイル着地後、統合側が本 PBI で整備した SSOT へ登録すること（台帳「バッチ計画」節）
- バッチ: W1（01 / 02 / 03 / 12 — LAYERS + eslint rules）
