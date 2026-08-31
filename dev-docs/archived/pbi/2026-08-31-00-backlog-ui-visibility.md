# バックログ優先度一覧 — 2026-08-31 UI/デザイン視認性

## この索引の読み方

- **対象**: `pbi/2026-08-31-NN` の UI/デザイン系統。ハードコード配色によるライト/ダーク視認性不良の是正を扱う。
- **系統の位置づけ**: VulnHunter セキュリティ修正（`2026-08-29-NN`）や クレンジング改善（`2026-08-30-NN`）とは**完全に独立**した新系統。着手日付・連番・Wave を別に採番する。
- **ファイル名の連番 `NN` は作成順**であり、RICE 優先度とは必ずしも一致しない。着手順は下記「推奨実行順」に従う。
- 各 PBI は `pbi-create-bdd` 準拠（ユーザーストーリー / ビジネス価値 / 優先度RICE / BDD シナリオ / 受け入れ基準 / テスト戦略 / 実装アプローチ / 見積もり / 技術的考慮事項 / 実装者向け注記 / DoD）。
- ファイル触接は主に `entrypoints/options/dashboard.css` と `src/styles/tokens.css`。29 系・30 系とは触接しない。

---

## 候補の列挙

| ファイル | タイトル | 種別 |
|---|---|---|
| 01 | ライトモード視認性改善 — Dashboard AIプロバイダー設定のトークン準拠化 | fix |

> 現時点で 1 件。以降 UI/デザインの視認性・トークン準拠の指摘が出たら本系統に `2026-08-31-02` 以降で追加する。

---

## 優先度付け — RICE

**計算式**: `RICE = (Reach × Impact × Confidence) / Effort`（Reach/Impact は 1–10 の相対値、Effort は日数。他系統とは尺度が異なる）

| 順位 | ファイル | Reach | Impact | Confidence | Effort | RICE |
|---|---|---|---|---|---|---|
| 1 | 01 ライトモード視認性（B分離型） | 6 | 3 | 0.9 | 0.5日 | **32.4** |

---

## 推奨実行順（依存関係と Wave）

### Wave 1（単独着手）
- **01 ライトモード視認性改善** — CSS のみ（3クラス + トグル1つ）のトークン置換。E2E 2ケース追加。依存なし。`dev-docs/DESIGN_TOKENS.md` の既存トークンを再利用し `tokens.css` は変更しない。

### 依存注記
- 30 系（クレンジング改善）の 06「プリセット」が `entrypoints/options/index.html` の DOM を触るが、本 PBI は CSS のみで DOM 構造を変えないため衝突しない。着手順に制約はない。
- A一体型（`.priority-details`, L4172-）は既にトークン準拠のため対象外。B分離型のみが修正対象。

---

## トレーサビリティ（PBI → 主要な触接ファイル）

| PBI | 主に触るファイル |
|---|---|
| 01 | `entrypoints/options/dashboard.css`（L4559-4604: `.ai-layout-toggle` / `.b-priority-row` / `.b-provider-details` / `.b-provider-summary` / `.b-priority-handle`）、`tests/e2e/dashboard-light-mode.spec.ts`（新規） |

> 行番号は各 PBI 作成時点のもの。着手時に該当セレクタで再確認すること。

---

**出典**: ユーザー報告（ライトモードで B分離型 AIプロバイダー設定パネルが黒背景で紙色 UI に浮く）、`dev-docs/DESIGN_TOKENS.md` の研墨テーマ配色方針。
