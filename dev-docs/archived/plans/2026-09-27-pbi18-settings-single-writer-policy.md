# PBI 18 調査報告: denied_domains / permission_notify_threshold の単一 writer 化 policy

PBI: `pbi/2026-09-25-18-investigate-settings-key-single-writer.md`（investigate・production code 変更なし）
依存: PBI 02（withLock CAS 裁定・完了アーカイブ済み、Contracts 強化採用 / value-level CAS 不採用）、PBI 17（settings migration completion state・完了アーカイブ済み、`SETTINGS_MIGRATION_SCHEMA_VERSION = 2`・4 段 stage）
C16（object conflict policy、ADR `2026-09-26-withlock-object-conflict-policy.md`）は確定済み: **value-level CAS は不採用、canonical deep-equal + lock 迂回 2 箇所の排除**。
日付: 2026-09-27

## 1. 所有表（現状の reader / writer / migration / export-import）

raw access 実サイトは 4 箇所（PBI 本文の「6 実アクセスサイト」は helper 内の 2 箇所と CAS 呼び出しを含む数え方。実質的な行番号は以下のとおり）:

| キー | reader | writer | migration | export/import |
|---|---|---|---|---|
| `denied_domains`（top-level 専用キー） | `permissionManager.ts:85`（`getDeniedDomains()` raw `chrome.storage.local.get`。呼び出し経路: getSuggestions / recordDeniedVisit / recordDomainDismissal の 3 経路） | `permissionManager.ts:98-105`（`updateDeniedDomains()` — **top-level に対する専用 `withOptimisticLock`**、updater は non-mutating 契約 pin 済み） | `settingsMigration` の nested `settings` blob には含まれない（top-level に残留）。PBI 17 の stage 分類では実値判定により `denied_domains` は legacy raw key 扱いにならない | `restorableSettings.ts` の `RESTORABLE_KEY_SPECS` に**意図的に含まれない**（閲覧履歴扱い） |
| `permission_notify_threshold`（nested `settings` blob のメンバー、DEFAULT_SETTINGS で 3） | `permissionManager.ts:281`（raw `chrome.storage.local.get` + クランプ 1-50） | `trustSettings.ts:565`（UI change ハンドラから **raw `chrome.storage.local.set`** — settings blob 全体ではなく 1 キーだけの top-level 上書き） | nested `settings` へは `settingsMigration`（PBI 17 の stage 機構）が管理。top-level 単キー write は blob と独立したキーになるため、migration 完了後は blob 側が正本 | `restorableSettings` に含まれる（`'permission_notify_threshold': { type: 'number' }`） |

型付き契約: `types.ts:144-145`（StorageKeys）、`types.ts:390-391`（CustomStorageShape）、`defaults.ts:109-110`（DEFAULT_SETTINGS）。`SettingsRepository` は型付き get/set + delta write 契約（`SettingsRepository.ts:181-227`）を持つ。

## 2. 5 Whys

### Q1: なぜ threshold の UI 変更が raw set を直接行うのか

- **事実**: `trustSettings.ts:562-568` の change ハンドラが `chrome.storage.local.set({ [PERMISSION_NOTIFY_THRESHOLD]: newValue })` を直接呼ぶ。`SettingsRepository` を経由しない。キーは nested `settings` blob のメンバーである一方、この write は 1 キーだけの独立 top-level エントリを作る。
- **裁定**: canonical writer を `SettingsRepository.set(StorageKeys.PERMISSION_NOTIFY_THRESHOLD, clampedValue)`（delta write）に統一する。UI ハンドラは repository を呼ぶだけにする。
- **根拠**: nested blob メンバーを top-level 単キーとして書くと、`getStorageItem('settings')` を読む reader が見る値と分岐し、PBI 17 の stage 機構（`settings_migrated` 完了後は blob が正本）と競合する。repository の delta write が blob 更新の正本経路。
- **残存リスク**: repository 経由にした場合、`withLock('settings')` の lock 競合に乗る。threshold の書き込み頻度は UI 操作のみ（権限拒否のような高頻度ではない）ため競合の実害は小さい。検証方法は後続 refactor のテストで確認（§5）。

### Q2: なぜ permissionManager が threshold を raw get するのか

- **事実**: `permissionManager.ts:281` は raw get で default 3 を補完し 1-50 にクランプする。`defaults.ts:110` に同一の既定値がある。
- **裁定**: reader も `SettingsRepository.get(StorageKeys.PERMISSION_NOTIFY_THRESHOLD)` に寄せる。クランプ処理（1-50）は permissionManager 内に保持（呼び出し側の防御）。
- **根拠**: 「reader を repository へ寄せるだけで UI の direct set を残すと単一 writer 化にならない」（PBI 落とし穴）の対偶として、writer 統一と reader 統一はセットで行う。
- **残存リスク**: なし（読み取りは冪等）。

### Q3: denied_domains は閲覧履歴か設定か

- **事実**: 値は `{ [domain]: { count, lastDenied, lastDismissed? } }` — ユーザーが「許可しない」と選んだ記録の訪問回数カウンタ（LRU 100 件上限、DoS 対策付き）。`restorableSettings` から意図的に除外されている。
- **裁定**: **閲覧履歴（端末固有データ）**。nested `settings` への統合は行わない。export/import 対象にもしない（現状の意図的除外を正とする）。
- **根拠**: (1) 値が訪問・拒否の履歴カウンタであり設定値ではない（2) 端末固有の閲覧履歴をエクスポートすると PII 境界（`restorableSettings` の除外設計）と矛盾する（3) C16 の裁定で value-level CAS は不採用のため、nested 化した場合の高頻度更新は `withLock('settings')` を通る — object conflict の誤検出と遅延のリスクが、統合の利益（キーの一元化）を上回る。
- **残存リスク**: 専用 store のままでは settings 一覧 UI・型付き契約から漏れる。`CustomStorageShape`（`types.ts:390`）に型付き契約が存在するため型安全性は確保済み。

### Q4: top-level dedicated key を残す根拠は何か（3 候補の検証）

- **(a) repository object CAS の回避 — 採用**: `recordDeniedVisit` は権限拒否のたびに呼ばれる高頻度 write。nested 化すると `withLock('settings')` を経由し、settings blob の他の write（設定保存・migration）と競合する。専用 `withOptimisticLock(DENIED_DOMAINS)` は lock 域が独立しており競合しない。**これが存続の本質的根拠**。
- **(b) 独立 quota — 不採用**: 100 件 LRU 上限（`MAX_DENIED_DOMAINS`）により volume は小さく、quota の独立性は実質的な利益にならない。確認できる根拠として採用しない（PBI 決定事項 2 の「確認できない理由を存続根拠にしない」に従う）。
- **(c) 履歴保持 — 部分採用**: settings blob の migration stage 機構から切り離されていることは意味がある（migration 中断時の消失・再実行リスクを負わない）。ただし (a) が主根拠で、これは副次的根拠として記録する。

### Q5: migration 中の writer precedence はどうなるか

- **事実**: PBI 17 により migration は `pending → backed_up → legacy_removed → completed` の単調 stage で進み、完了後は nested `settings` blob が正本。
- **裁定**: (1) `denied_domains` は migration 対象外（top-level 専用キー維持）なので migration と競合する経路が存在しない。(2) `permission_notify_threshold` は canonical writer を repository に一本化した時点で、旧 raw set 経路は**削除**（受理・変換ではなく廃止）。旧経路を「残す条件」は存在しない — UI change ハンドラのみが唯一の呼び出し箇所であり、後続 refactor で同時に直す。
- **根拠**: PBI 落とし穴「migration 完了前に旧 top-level write と新 nested write の両方を許可すると、二つの writer が再導入される」。旧経路の呼び出し箇所が 1 箇所のみであることを棚卸しで確認済み（§1）。
- **残存リスク**: dashboard の他の raw set が将来追加された場合に再発する。後続 refactor で「`trustSettings.ts` 内の `chrome.storage.local.set` 直接呼び出し 0 件」を lint/sweep で pin する契約を含める（§5）。

## 3. 裁定まとめ

| 項目 | 裁定 |
|---|---|
| `denied_domains` の責務 | **閲覧履歴（端末固有）**。nested `settings` への統合はしない。export/import には含めない（意図的除外を正） |
| `denied_domains` の writer | `permissionManager.updateDeniedDomains()`（専用 top-level CAS）を canonical writer として**維持**。他の writer は存在しない（棚卸し済み） |
| top-level dedicated key の存続根拠 | (a) 高頻度 write の lock 域独立性（本質）+ (c) migration stage 機構からの切り離し（副次）。(b) 独立 quota は不採用 |
| `permission_notify_threshold` の canonical writer | `SettingsRepository`（delta write）。reader も repository に統一 |
| 旧 raw set（trustSettings.ts:565） | 後続 refactor で repository 呼び出しに置換し、**廃止**（受理・変換しない） |
| C16（object conflict policy）との関係 | denied_domains の nested 統合は C16 + PBI 02 の評価が前提という PBI 条件は**既に満たされている**（両方完了済み）。裁定は「統合しない」で確定 — 統合前提の評価は不要になった |
| キー名変更 | 行わない（`denied_domains` / `permission_notify_threshold` の両方維持） |

## 4. 性能検証の基準（高頻度 CAS）

- 現状: `recordDeniedVisit` は専用 CAS（lock key `denied_domains`）で `withLock('settings')` と独立。高頻度記録が settings blob の lock を取らない。
- 裁定後も変わらない: denied_domains を nested にしないため、性能特性は現状維持。
- 後続 refactor の検証方法: 既存 `permissionManager.test.ts` の pin（top-level read/write の多数）を維持したまま、`withLock('settings')` 呼び出し回数が denied_domains 経路で 0 であることを spy で pin する。
- threshold の repository 経由化について: UI 操作頻度のみのため lock 競合の実害なし。delta write 契約（cached full snapshot を `setAll()` に渡さない）を遵守する。

## 5. 後続 refactor PBI の仕様（2 SP → 1 SP に縮小）

**PBI**: `fix` ではなく `refactor`（外部挙動不変の writer 統一）。推定 1 SP（当初 2 SP 見込みから、denied_domains が「維持のみ」に確定したため削減）。

**実装範囲**:
1. `trustSettings.ts:565` の raw set → `SettingsRepository.set(StorageKeys.PERMISSION_NOTIFY_THRESHOLD, newValue)`（クランプ 1-50 は呼び出し側で維持）
2. `permissionManager.ts:281` の raw get → repository get（クランプ維持）
3. denied_domains は production 変更なし（維持裁定の実装）

**Outside-In テスト順**:
1. 期待動作テスト（Red）: 設定画面で threshold を変更 → repository の delta write が 1 回呼ばれる / raw `chrome.storage.local.set` が 0 回
2. 既存テスト変更対象: `trustSettings.test.ts:434-437`（直接 set を検証する pin → repository 呼び出し pin へ）。`trustSettings-r2` / `trustSettings-r3` の同系 pin
3. `permissionManager.test.ts` の top-level pin は denied_domains 分を維持、threshold raw get 分は repository 経由に更新
4. **契約 pin**: `trustSettings.ts` 内の `chrome.storage.local.set` 直接呼び出し 0 件を static test（既存 `check-deprecated-aliases` 流の sweep か lint ルール）で固定
5. 移行順序: handler の差し替えのみ（storage キー構造・migration 不変）
6. **ロールバック条件**: repository delta write が nested blob の既存値を壊す（再読込で threshold が変わる）場合は raw set へ戻す（キー構造不変のため revert は 1 ファイル）

**制約（後続 PBI へ引き継ぎ）**:
- 既存 storage キー名を変更しない
- ESM import `.js` 付与・async/await 維持
- `SettingsRepository` の型付き get/set + delta write 契約を使用し、cached full snapshot を `setAll()` に渡さない
- API key の restore 対象契約（`restorableSettings`）は変えない
- migration parity テスト（`settingsRepository-migration-parity.test.ts` / `restorableSettings.test.ts` / `restorableSettings-spec-table.test.ts`）を green 維持

## 6. 受け入れ基準との対応（PBI 18 DoD）

- 所有表: §1 ✅
- 5 Whys と結論: §2 ✅
- 単一 writer と raw write の不可避理由: §3（denied_domains の writer は「不可避な raw」ではなく canonical writer として正式に採用。raw write 残留は 0 件）✅
- export/import 契約: §2 Q3・§3（含めない。意図的除外を正）✅
- migration precedence と C16 依存: §2 Q5・§3 ✅
- 高頻度 CAS の競合と遅延の検証方法: §4 ✅
- 後続 refactor PBI の仕様: §5 ✅
- キー名不変・.js・async/await・型付き契約の制約: §5 制約 ✅
- investigate として完了・実装は後続 refactor: 本報告書のみで production 変更なし ✅
