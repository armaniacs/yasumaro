# バックログ優先度一覧 — 2026-08-21 VulnHunter 指摘対応

## 候補の列挙（フェーズ0）

VulnHunter 2026-08-21 スキャン（Run ID: `obsidian-smart-history_VULNHUNT_RESULTS_2026-08-21-064541`）で検出された1件の Code Quality 指摘を独立候補として抽出:

| # | 候補 | 種別 | 出典 |
|---|---|---|---|
| 1 | confirmToken の定数時間比較への置換（`index.ts:42` の `!==` → `constantTimeCompare`） | fix | VulnHunter Phase 2b VULN-LOG-001（CWE-208 Low, false positive）`src/background/handlers/dashboardSqlite/index.ts:42` / 推奨 `src/utils/crypto/primitives.ts:67` |

- 重複候補なし
- 統合提案なし（単一候補）

---

## 各候補の理解（フェーズ1）

| 候補 | 何を作るか | 誰のため | なぜ必要 | 制約 |
|---|---|---|---|---|
| 1 | `dashboardSqlite/index.ts:42` のトークン比較を `constantTimeCompare` に置換 | 開発者 / セキュリティ監査 | `!==` のタイミング差分を理論上でも除去し、HMAC 検証と同水準の防御一貫性を確保。将来の権限スコープ拡大時のリスクを未然に防ぐ。現行はローカル拡張 + `chrome.storage.local` 代替取得可能なため exploitable ではないが、監査指摘ゼロ化と defense-in-depth のため | 既存 `primitives.ts:67` を再利用、async 化必須（`await` 忘れ厳禁）、`providedToken` undefined ガード維持、読み取り系はトークン不要のまま |

不足情報はなし。提示文と `phase2b_output.md` / `src/background/handlers/dashboardSqlite/index.ts` / `src/utils/crypto/primitives.ts:67` から全項目を復元できたため追加質問は不要。

---

## 優先度付け（フェーズ2） — RICE

### スコアリング

| 順位 | 候補 | Reach | Impact | Confidence | Effort | RICE | 根拠 |
|---|---|---|---|---|---|---|---|
| 1 | confirmToken 定数時間比較 | 1000 | 0.25 | 100% | 0.1人月 | **2500** | 全利用者に配布されるコードの監査品質に直結するが、現行は false positive のため Impact は極小 (0.25)。Confidence は 100%（修正箇所1行に特定、置換先はテスト済み）。Effort は 0.5日相当（0.1人月）。WSJF 参考値 15（CoD 1.5 / JS 0.1）。依存なし。唯一の gate 漏れを最安で塞げるため先頭 |

**計算式**: `RICE = (Reach × Impact × Confidence) / Effort = (1000 × 0.25 × 1.0) / 0.1 = 2500`

### 依存関係
- 候補1は他候補に依存しない（単独候補）
- 将来 `hmacKeyStore.ts:314` との実装集約は本PBIのスコープ外（別PBIで検討）

### 同点時の決定
- 単一候補のため不要

### 最終順位
1. `2026-08-21-01-fix-constant-time-confirm-token.md`（RICE 2500）

---

## 疑問の解決 — なぜなぜ分析（フェーズ3）

フェーズ1・2で生じた疑問は「なぜ exploitable ではない指摘を直すのか（Impact 0.25 の根拠）」の1点。以下の5 Why で自律解決した。

### 疑問1: なぜ false positive の CWE-208 を直すのか？

**疑問を一文で明確化**: 「ローカル拡張で実践的悪用不可と評価された `!==` を、なぜ工数をかけて直すのか — Impact をどう見積もるべきか」

**なぜの連鎖**:

1. **なぜ `!==` が問題か？** → 文字列比較が先頭不一致で早期 return するため、トークンの一致位置が実行時間に反映され、理論上は1文字ずつ推測できる（CWE-208）。
2. **なぜ現行では悪用不可か？** → Chrome 拡張はユーザーのローカル環境で動作し、攻撃に必要な `chrome.runtime.sendMessage` 権限を持つ主体は既に `chrome.storage.local` から正トークンを直接読める。タイミング攻撃より簡単な経路が存在する。
3. **なぜそれでも直すのか？** → 防御は各レイヤーで独立して正しくあるべき（defense-in-depth）。「別経路で読めるから比較は雑でよい」は将来の前提崩れに弱い。現行コードベースでも HMAC 検証（`hmacKeyStore.ts:314`）は定数時間で行われており、同一コードベース内で防御水準が不均一だと監査で指摘が残り続ける。
4. **なぜ将来の前提が崩れる可能性があるのか？** → `confirmToken` のスコープが将来拡大（例: 共有環境、管理者機能、リモート検証）した場合、タイミング安全でない比較がそのまま残ると exploitable に昇格する。現時点で最も安価に塞げる gate 漏れでもある（1行置換 + テスト1ファイル）。
5. **なぜ Impact を 0.25 としたのか？** → 現行の exploitable risk はゼロに近いが、監査指摘ゼロ化 + 将来リスクの予防 + 防御一貫性の3点を合わせても「極小」と評価するのが相対的に正確。Reach は全利用者に配布されるため 1000 とし、Effort 0.1 との比で RICE 2500 とした。

**原因 → 示唆 → 解**:

- **原因**: `dashboardSqlite/index.ts:42` で `!==` を使っている。HMAC 側は定数時間なのに confirmToken 側だけ非定数時間という不均一。
- **示唆**: `src/utils/crypto/primitives.ts:67` の `constantTimeCompare` は既存・テスト済みで再利用可能。async だが handler は既に async のため呼び出し側の変更は最小。
- **解**: 本PBIで `await constantTimeCompare` に置換し、単体テストで分岐を固定。Impact は 0.25（将来予防）として RICE を算出し、単一候補の先頭として即時対応する。hmac 側との二重実装集約は別PBIに分離。

**行動移行の可否**: 上記解で PBI 化・優先度付けに移行可能。追加のユーザー質問は不要。

---

## PBI作成（フェーズ4）

優先順に各候補をPBI化:

| 順位 | PBIファイル | RICE | 概要 |
|---|---|---|---|
| 1 | `pbi/2026-08-21-01-fix-constant-time-confirm-token.md` | 2500 | confirmToken の定数時間比較への置換（CWE-208） |

各PBIは `pbi-create-bdd` 準拠（ユーザーストーリー / 優先度 / BDD 4シナリオ / 受け入れ基準7項目 / テスト戦略 Outside-In / 見積もり1pt / DoD）。

---

## ファイル出力（フェーズ5）

- `pbi/2026-08-21-01-fix-constant-time-confirm-token.md` — 優先度1（RICE 2500）
- `pbi/2026-08-21-00-backlog.md` — 本ファイル（バックログ一覧 + RICE + なぜなぜ分析）

ファイル名の `NN` が着手順を示す。`01` が最初に着手するPBI。
