# Backlog: Checking Team Low 残課題ラウンド 2026-10-16（checking-team-1016）

Checking Team レビュー（2026-10-16、総合 92.9/100・ランク S）の Low 15 件を作業ツリーで実測し、
解消済み 4 件を除外、残り 11 件を独立実装単位に分解して RICE 採点・PBI 化（NN01-11）。
Medium 19 件は同日 Phase 5 で対応済み（未コミット）。

- レビュー報告書: [plans/2026-10-16-0457-review-main.md](../../plans/2026-10-16-0457-review-main.md)（`plans/` は gitignore 対象の作業用コピー）
- レビュー対象: 前回 checking-team 時点 `c7bd180c` → HEAD `727810f6`（112コミット / 277ファイル）
- 解消済みとして PBI 化しない 4 件: Low #5（PERMISSIONS 重複語・Phase 5 で修正）/ Low #6（focusTrap コメント・Phase 5 で修正）/ Low #9（web-ext 実行時取得・Phase 5 で lockfile 化）/ Low #14（二重変換 cast・Phase 5 で削除）。いずれも作業ツリーで実測確認済み
- 依存関係なし。全 PBI の触るファイルは互いに非重複（NN02 と NN06 は `messages.json` を共有するため直列）

## RICE スコアリング

```
RICE = (Reach × Impact × Confidence) / Effort
Reach: 今後1年の保守・利用での関与頻度（相対 1-10）
Impact: 3=実害解消 / 2=大きい / 1.5=中（部分的に実害） / 1=中 / 0.5=小
Confidence: 1.0=コード・実測で確定 / 0.8=設計判断が残る / 0.5=効果が不確か
Effort: ストーリーポイント
```

| NN | PBI | 種別 | R | I | C | E | RICE | SP | 依存 |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| 01 | [2026-10-16-01-fix-unknown-subtype-fail-open.md](2026-10-16-01-fix-unknown-subtype-fail-open.md) | fix | 6 | 2 | 1.0 | 1.0 | 12.0 | 1.0 | なし |
| 02 | [2026-10-16-02-fix-getmessageor-japanese-fallback.md](2026-10-16-02-fix-getmessageor-japanese-fallback.md) | fix | 3 | 1 | 1.0 | 0.5 | 6.0 | 0.5 | なし |
| 03 | [2026-10-16-03-fix-log-severity-unification.md](2026-10-16-03-fix-log-severity-unification.md) | fix | 3 | 0.5 | 1.0 | 0.25 | 6.0 | 0.25 | なし |
| 04 | [2026-10-16-04-fix-is-deleted-double-predicate.md](2026-10-16-04-fix-is-deleted-double-predicate.md) | fix | 9 | 0.5 | 1.0 | 1.0 | 4.5 | 1.0 | なし |
| 05 | [2026-10-16-05-fix-opfs-load-shed-retry.md](2026-10-16-05-fix-opfs-load-shed-retry.md) | fix | 4 | 2 | 0.8 | 1.5 | 4.3 | 1.5 | なし |
| 06 | [2026-10-16-06-fix-fieldvalidation-japanese-hardcode.md](2026-10-16-06-fix-fieldvalidation-japanese-hardcode.md) | fix | 4 | 1 | 1.0 | 1.0 | 4.0 | 1.0 | **NN02 の後**（messages.json 共有） |
| 07 | [2026-10-16-07-fix-local-sqlite-error-code.md](2026-10-16-07-fix-local-sqlite-error-code.md) | fix | 4 | 0.5 | 1.0 | 0.5 | 4.0 | 0.5 | なし |
| 08 | [2026-10-16-08-fix-privacy-mode-compat-info.md](2026-10-16-08-fix-privacy-mode-compat-info.md) | fix | 2 | 1.5 | 0.8 | 1.0 | 2.4 | 1.0 | なし |
| 09 | [2026-10-16-09-refactor-status-mirror-helper.md](2026-10-16-09-refactor-status-mirror-helper.md) | refactor | 2 | 0.5 | 1.0 | 0.5 | 2.0 | 0.5 | なし |
| 10 | [2026-10-16-10-refactor-manifest-localhost-gate.md](2026-10-16-10-refactor-manifest-localhost-gate.md) | refactor | 2 | 1 | 0.8 | 1.0 | 1.6 | 1.0 | なし |
| 11 | [2026-10-16-11-chore-remove-e2e-probe-attributes.md](2026-10-16-11-chore-remove-e2e-probe-attributes.md) | chore | 1 | 0.5 | 0.8 | 0.5 | 0.8 | 0.5 | なし |

RICE = R × I × C / E。値は各 PBI 内「RICE」行と一致。

## 実行順（確定）とバッチ計画

RICE 降順（依存を尊重）。同点の裁定:
- **6.0 の 2-way**: NN02（ユーザー実害・I=1）を先頭。以後 NN03（ログのみ・I=0.5）
- **4.0 の 2-way**: NN06（ユーザー実害・I=1）を先頭。以後 NN07（ログのみ・I=0.5）
- NN06 は NN02 と `messages.json` を共有するため **必ず直列（NN02 → NN06）**

| Wave | NN | 内容 | 非重複根拠 |
|---|---|---|---|
| W1 | 01 / 03 / 04 / 09 / 11 | validators+tests / headerDetector / queryPlan+twins / settingsUiHelper / test-pages+e2e spec | 5 群が互いに非重複 |
| W2 | 02+06（同一担当で直列） / 05 / 07 / 08 / 10 | sourceManager+fieldValidation+messages.json / opfsWorker / panels×10 / settingsExportImport / manifest.test | 群間は非重複。02→06 は同一ファイル共有のため直列 |

**共通ファイル（統合側がバッチ境界で 1 回だけ更新）**: `pbi/00-INDEX.md`、本台帳。

## 台帳送り（見送り・トリガー管理）

なし（11 件すべて着手可能。Low #2 の headed E2E 未検証は NN11 の受け入れ基準に記録済み）。
