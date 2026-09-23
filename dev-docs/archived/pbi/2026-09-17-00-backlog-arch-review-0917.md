# 台帳: 2026-09-17 アーキテクチャレビュー指摘の PBI 化（arch-review-0917）

コードベース全体を対象とした大局的アーキテクチャレビュー（DRY / SoC / 拡張性・抽象化 / 堅牢性・セキュリティの4観点）で抽出した改善候補11件を RICE 採点し、10件を PBI 化した台帳。レビューの詳細な分析（各テーマの背景・影響・該当箇所・改善案）は本台帳の各 PBI に引き継がれている。

---

## 採点基準（全候補共通）

- **Reach**: 今後1年間の保守作業での関与頻度（相対 1-10）。10=ほぼ毎週・全記録経路 / 5=月次 / 3=四半期 / 1=年次以下
- **Impact**: 3=実害解消 / 2=大きい（セキュリティ修正の波及構造化等） / 1=中（重複削減・規範化） / 0.5=小（混乱削減・文書化）
- **Confidence**: 1.0=コードで確定 / 0.8=設計判断が残る / 0.5=効果が不確か
- **Effort**: ストーリーポイント（🟢1 / 🟡2 / 🔴3+）

## RICE 採点表（全11候補）

| 候補 | R | I | C | E | RICE | 扱い |
|---|---|---|---|---|---|---|
| OpenAI 系接続テストの表示ラベル混入 | 5 | 2 | 1.0 | 0.5 | 20.0 | PBI 化（順位1） |
| GistSyncTarget の settingsReader シーム迂回 | 3 | 1 | 1.0 | 0.5 | 6.0 | PBI 化（順位2） |
| Markdown エントリ生成の SSOT 統合 | 10 | 2 | 0.8 | 3 | 5.33 | PBI 化（順位3・実行順4） |
| utils 層境界の lint 強制 | 8 | 2 | 0.8 | 3 | 4.27 | PBI 化（順位4・実行順5） |
| ObsidianSyncService 死コードの裁定 | 5 | 0.5 | 0.8 | 0.5 | 4.0 | PBI 化（順位5・実行順3） |
| SettingsRepository アクセス統制 | 8 | 1 | 0.8 | 2 | 3.2 | PBI 化（順位6） |
| built-in AI 二重アダプタの ADR 裁定 | 3 | 1 | 0.8 | 1 | 2.4 | PBI 化（順位7） |
| module singleton 併存方針の ADR 裁定 | 6 | 0.5 | 0.8 | 1 | 2.4 | PBI 化（順位8） |
| バックオフ/HTTP 文言の SSOT 化 | 4 | 1 | 0.8 | 2 | 1.6 | PBI 化（順位9） |
| testConnection テンプレ化+カタログ SSOT 昇格 | 4 | 1 | 0.8 | 3 | 1.07 | PBI 化（順位10） |
| MAX_PROVIDERS 超過の明示化 | — | — | — | — | — | **台帳送り**（下記） |

## 実行順（NN = ファイル番号）と純 RICE 順からの逸脱

実行順は RICE 降順を基本とするが、**依存はスコアより優先**した。逸脱は2箇所:

1. **実行順 03（ObsidianSyncService 死コード削除・RICE 4.0）→ 04（Markdown SSOT 統合・RICE 5.33）の入れ替え**: 同一ファイル群を触る順序依存。削除予定の `obsidianSyncService.ts` が Markdown 重複5箇所の1つであり、先に統合すると消えるコードに工数を費やすため、削除を先にする
2. **実行順 10（testConnection テンプレ化）を 01（ラベル修正）の後に固定**: 同一 `testConnection()` を触る順序依存。01 は最小差分の先行修正であり、10 のテンプレ化がその差分を引き継ぐ

| NN | ファイル | RICE |
|---|---|---|
| 01 | [2026-09-17-01-fix-ai-provider-test-label.md](2026-09-17-01-fix-ai-provider-test-label.md) | 20.0 |
| 02 | [2026-09-17-02-fix-gist-sync-settings-reader-seam.md](2026-09-17-02-fix-gist-sync-settings-reader-seam.md) | 6.0 |
| 03 | [2026-09-17-03-refactor-obsidian-sync-dead-code.md](2026-09-17-03-refactor-obsidian-sync-dead-code.md) | 4.0 |
| 04 | [2026-09-17-04-refactor-markdown-entry-ssot.md](2026-09-17-04-refactor-markdown-entry-ssot.md) | 5.33 |
| 05 | [2026-09-17-05-refactor-utils-layer-boundary-lint.md](2026-09-17-05-refactor-utils-layer-boundary-lint.md) | 4.27 |
| 06 | [2026-09-17-06-refactor-settings-repository-discipline.md](2026-09-17-06-refactor-settings-repository-discipline.md) | 3.2 |
| 07 | [2026-09-17-07-investigate-builtin-ai-dual-adapter.md](2026-09-17-07-investigate-builtin-ai-dual-adapter.md) | 2.4 |
| 08 | [2026-09-17-08-investigate-module-singleton-policy.md](2026-09-17-08-investigate-module-singleton-policy.md) | 2.4 |
| 09 | [2026-09-17-09-refactor-backoff-http-failure-ssot.md](2026-09-17-09-refactor-backoff-http-failure-ssot.md) | 1.6 |
| 10 | [2026-09-17-10-refactor-ai-test-connection-template.md](2026-09-17-10-refactor-ai-test-connection-template.md) | 1.07 |

同点（07 と 08・RICE 2.4）は「リスク軽減効果」で決定: built-in AI の二重表現は誤統合による `local_only` モード破壊の実リスクがあるため上位。

## 台帳送り（PBI 化しない候補と再検討トリガー）

### MAX_PROVIDERS 超過の明示化

`RemoteAIService` が provider 優先順位リストを `slice(0, MAX_PROVIDERS=10)` で切り詰めるが、設定 UI（`settingsForm.ts` の `collectProviderPrioritySlots`）は優先度3スロットまでしか組み立てられず、通常の操作で cap に到達する経路が存在しない（防御的上限）。サイレント欠落の実害がないため PBI 化を見送り。

- **再検討トリガー**: provider スロットを UI 側で5個以上に拡張する場合、または settings import 等で UI を経由しないスロット生成経路を追加する場合。その際は超過分のログ出力+設定 UI 警告をセットで対応する

### utils/ の物理再階層化（ディレクトリ移動）

本ラウンドでは PBI 05 を「既存 `dev-docs/LAYERS.md` の層定義を import boundary lint で機械化+違反是正」にスコープ縮小した。物理再配置（約120モジュールの移動）は効果が主観的でマージコストが大きく、lint による機械化が先行すれば価値の大半が得られるため移設は保留。

- **再検討トリガー**: PBI 05 完了後に violation 率・循環 dynamic import の残数が基準を超える場合、または `utils/` 配下の新規追加が月間一定数を超えて分類作業が継続コスト化する場合

## 依存マップ

```
01 (ラベル修正) ──→ 10 (testConnection テンプレ化)
03 (死コード削除) ──→ 04 (Markdown SSOT 統合)
02 (Gist reader) ⊂ 06 (SettingsRepository 統制)   ※02 を先に、06 からは3箇所除外
05 (境界 lint) は独立（06 の ESLint 追加とは別系統）
07 / 08 / 09 は独立
```

## レビューで確認済みの強み（本ラウンドでは着手しない）

- Composition Root + 宣言的 DI（`compositionManifest.ts`）、Deep Module（`MessageRouter` / `RecordingOrchestrator` / `SettingsRepository`）
- AI プロバイダー層の Template Method（`executeHttpSummaryFlow`）+ providerCatalog registry
- `PersistentRetryQueue` の promise-chain ロック（VULN-056）、per-URL Mutex、Confirm Token、sender trust / envelope policy
- セキュリティ基盤（SSRF allowlist、capped body reads、API キー暗号化、定数時間比較）

本ラウンドの改善候補はすべて「リファクタリングの波が最後まで届いていない境界」への適用であり、既存の SSOT + parity テスト手法で安全に進められる。
