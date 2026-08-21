# PBI: confirmToken の定数時間比較への置換（CWE-208）

## ユーザーストーリー
開発者として、Dashboard SQLite の `confirmToken` 検証を定数時間比較に置換したい、なぜなら `!==` によるタイミング差分を理論上でも除去し、HMAC 検証と同水準の防御一貫性を確保し将来の権限スコープ拡大時のリスクを未然に防ぎたいから

## ビジネス価値
- 現状は false positive（ローカル拡張の攻撃面 + `chrome.storage.local` で代替取得可能なため実践的悪用不可）だが、防御の不均一性（HMAC は定数時間、`confirmToken` は非定数時間）を解消することでセキュリティ監査での指摘をゼロにする
- 将来 `confirmToken` がクロスオリジンや共有環境で使われた場合でも安全な基盤を残す（将来コストの回避）
- 測定方法: `src/background/handlers/dashboardSqlite/index.ts:42` が `constantTimeCompare` を経由することを単体テストで固定し、VulnHunter 再スキャンで CWE-208 が Code Quality からも消えること

## 優先度
- 順位: 1 / 1
- RICEスコア: 2500（Reach=1000 / Impact=0.25 / Confidence=100% / Effort=0.1人月）
  - Reach 1000: 全利用者のインストールに配布されるコードであり監査品質に直結
  - Impact 0.25: 現行では exploitable ではない defense-in-depth（極小）。将来リスク軽減が主目的
  - Confidence 100%: 修正箇所は `index.ts:42` の1行に特定済み、置換先 `constantTimeCompare` は既存・テスト済み（`src/utils/crypto/primitives.ts:67`、`crypto.test.ts:274`）
  - Effort 0.1: async 化とテスト追加を含めて 0.5日程度（Mutex やストレージ変更は不要）
- WSJF参考: Cost of Delay = 1.5（BV 0.5 + 緊急性 0.5 + リスク軽減 0.5）/ Job Size 0.1 = 15 — 低緊急度
- 根拠: 単一候補のため相対比較は不要。依存関係なし。唯一の gate 漏れ（タイミング安全でない比較）を最も安価に塞げるため、バックログ先頭で即時対応が合理的。VulnHunter Code Quality 推奨の直接対応でもある

## BDD受け入れシナリオ

```gherkin
Scenario: 正しい confirmToken で破壊的操作が成功する（ハッピーパス）
  Given 有効な confirmToken が chrome.storage.local に保存されている
  When ダッシュボードが payload { subtype: "clear_all", confirmToken: "<valid>" } で DASHBOARD_SQLITE を送信する
  Then Service Worker は confirmToken を定数時間比較で検証し
  And 対象操作（clear_all）が実行され { success: true } が返る

Scenario: 不正な confirmToken はタイミング差なく拒否される
  Given 有効な confirmToken が保存されている
  When ダッシュボードが長さ・先頭文字・末尾文字が異なる3種類の不正トークンで破壊的操作を送信する
  Then いずれも { success: false, error: "Confirmation token mismatch" } が返り
  And 検証は文字列長や不一致位置に依存しない時間特性で行われる（単体テストで文字位置ごとの実行時間差が許容閾値内に収まる）

Scenario: confirmToken 未指定は拒否される（境界ケース）
  Given 有効な confirmToken が保存されている
  When payload に confirmToken を含めずに TOKEN_REQUIRED_SUBTYPE を送信する
  Then 操作は実行されずトークン不一致エラーが返る

Scenario: 読み取り系はトークン不要のまま動作する（回帰防止）
  Given 任意の confirmToken 状態
  When payload { subtype: "query" } など TOKEN_EXEMPT_OPS の操作を送信する
  Then トークン検証を経由せず読み取りが成功する
```

## 受け入れ基準
- [x] `src/background/handlers/dashboardSqlite/index.ts:42` の `providedToken !== validConfirmToken` が `await constantTimeCompare(providedToken, validConfirmToken)`（または同等の定数時間 helper）に置換されている
- [x] `constantTimeCompare` は `src/utils/crypto/primitives.ts:67` の既存実装を再利用する（hmacKeyStore.ts の個別実装を複製しない。必要なら primitives からの re-export を経由）
- [x] `providedToken` が undefined/null の場合でも定数時間比較の呼び出し前にガードされ、安全に false を返す（例外を投げない）
- [x] 既存テスト `src/background/__tests__/dashboardSqliteHandlers-*` が全てグリーン（破壊的操作の成功/失敗分岐が維持される）
- [x] 新規/更新した単体テストで「正トークン成功」「不正トークン3パターン失敗」「トークン未指定失敗」「読み取り系はトークン不要」が検証されている
- [x] `npm run type-check` と `npm run validate` が成功する
- [x] VulnHunter 再スキャン（該当 sink の grep）で `!== validConfirmToken` パターンが 0件になる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし（Chrome 拡張の Service Worker メッセージングは jsdom/単体で十分に検証可能。E2E は既存 Playwright スイートに委譲）

### 統合テスト
- `src/background/handlers/dashboardSqlite/index.ts` の handler 統合テスト: `deps.getConfirmToken` をモックし、正/不正/未指定トークンでの分岐を `createDashboardSqliteHandler` 経由で検証。読み取り系がトークン不要のままであることも同一スイートで検証

### 単体テスト
- `constantTimeCompare` 自体は既存 `src/utils/crypto/__tests__/crypto.test.ts:274` でカバー済み — 追加不要
- 新規: `src/background/handlers/dashboardSqlite/__tests__/confirmTokenConstantTime.test.ts`（仮）
  - ビジネスロジック: 有効トークンと一致/不一致の真偽が正しいこと
  - 境界値: 空文字、長さ違い、先頭/末尾のみ違い、undefined
  - 例外: `providedToken` が非文字列（number/null）で渡された場合のガード（validator が弾くことを確認、handler は false 返却）

## 実装アプローチ
- **Outside-In**: まず `createDashboardSqliteHandler` の統合テストを Red（`!==` のままではタイミング安全を主張できない）にし、`await constantTimeCompare` 置換で Green にする。最後に不要な重複があればリファクタ
- **Red-Green-Refactor**: 各テストを1シナリオずつ追加し、最小差分で置換。`hmacKeyStore.ts:314-321` の個別ループを再利用せず `primitives.ts:67` に集約

## 見積もり
1pt（要チームでの見積もり — 実装は1行置換 + テスト1ファイル。0.5日以内）

## 技術的考慮事項
- 依存関係: なし（`src/utils/crypto/primitives.ts:67` は既存安定モジュール）
- テスタビリティ: `DashboardSqliteHandlerDeps.getConfirmToken` をモック可能。`constantTimeCompare` は Promise を返すため handler は `async` のまま維持（既に async）
- 非機能要件: パフォーマンス影響は無視可能（トークン長は数十文字、ループは O(maxLen)）
- 既存不整合: `hmacKeyStore.ts:314` と `primitives.ts:67` に2通りの定数時間実装が併存している。本 PBI では `primitives.ts` に統一し、hmac 側は将来別 PBI で集約を検討（本 PBI のスコープ外）

## 実装者向け注記

### 現状コードの確認
着手前に必ず実行すること:

```bash
grep -rn "validConfirmToken\|confirmToken" src/background/handlers/dashboardSqlite --include="*.ts"
grep -rn "constantTimeCompare" src/utils/crypto --include="*.ts"
sed -n '38,55p' src/background/handlers/dashboardSqlite/index.ts
sed -n '67,85p' src/utils/crypto/primitives.ts
```

- 現状: `index.ts:42` で `providedToken !== validConfirmToken`（非定数時間）
- 置換先: `src/utils/crypto/primitives.ts:67` の `constantTimeCompare(a,b): Promise<boolean>`（長さ差も timing-safe）
- 既実装確認: 未実装（定数時間比較への置換は未対応）— VulnHunter 2026-08-21 でも Code Quality として指摘されたまま

### 実装手順
1. `src/background/handlers/dashboardSqlite/index.ts` 先頭で `import { constantTimeCompare } from '../../../utils/crypto/primitives.js'` を追加（既存 import 群に追記。パスは `src/utils/crypto/index.ts` 経由の re-export でも可）
2. `if (!providedToken || providedToken !== validConfirmToken)` を `if (!providedToken || !(await constantTimeCompare(providedToken, validConfirmToken)))` に置換。`providedToken` は string | undefined のため `!providedToken` ガードは維持
3. `src/background/handlers/dashboardSqlite/__tests__/confirmTokenConstantTime.test.ts` を新規作成し、上記 BDD の4シナリオを `describe` に落とし込む（`getConfirmToken` はモック、handler は `await createDashboardSqliteHandler(deps)({subtype, confirmToken})` で呼び出し）
4. `npm run type-check && npm run validate` で回帰確認。`grep -rn "validConfirmToken" src --include="*.ts"` で `!==` が消えたことを確認

### 落とし穴
- `constantTimeCompare` は `Promise<boolean>` を返す — `await` を忘れると常に truthy になり全トークンが通過する。必ず `await` すること
- `providedToken` が undefined のとき `constantTimeCompare(undefined, ...)` を呼ばないようガード順序を維持すること（`!providedToken` を先に評価）
- `hmacKeyStore.ts` の手動ループをコピペしないこと — `primitives.ts` に一本化されているため重複実装を増やさない
- テストでタイミング計測を厳密にやろうとしないこと — 単体テストでは「比較が定数時間関数を経由している」ことの呼び出し検証で十分（実タイミング計測は不安定）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [x] ドキュメント更新済み（必要なら dev-docs/ERROR_CODES.md 等 — 本PBIでは不要想定）
