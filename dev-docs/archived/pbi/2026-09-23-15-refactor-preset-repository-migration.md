# PBI 2026-09-23-15 — preset dual-write の repository 移行

**優先度**: 順位 15 / RICE 4.0（Reach 4 × Impact 2 × Confidence 50% ÷ Effort 1.0 人週）
**根拠**: preset store の素 storage 接触 7 箇所と dual-write race を除去し、keystroke 毎の全読みを targeted read にする。Confidence 50% は race 敏感領域のため。
**種別**: refactor（非機能追加）

## 背景

同一 settings interface が 3 箇所に所有されている: `cleansingPresetStore.ts:132-215` は `CLEANSING_PRESET` トップレベルキーを repository Seam を bypass して素 read（134/142/153/207）＋dual write（190-194: `setAll(delta)`＋素 `set`）し、`perSiteOverrides.ts:66-148` は delta write 正しいが toggle 毎に `getAll()` 全読みする。repository（`SettingsRepository.ts:98-228`）は observe・1s cache・delta write を備えるが preset key では未使用のため、epoch/busy-window guard が Seam なら防げる race を補償している。

## 実装戦略

1. `CLEANSING_PRESET` を SettingsRepository interface 背後に移す（typed read/write＋observe 購読）。read 移行＋fallback を先行し、write を後行する。
2. `perSiteOverrides` に同 Seam 上の薄い store Adapter を与える（load は targeted read、save は delta 維持）。
3. preset store の Depth（busy window・epoch・migration heuristic）は保持し、素 `chrome.storage.local` 接触を 0 にする。
4. `CLEANSING_RULES` の暫定許可 ADR（2026-09-17-defaults-cleansing-rules-provisional-allow）に触れない。

## 受け入れ基準（BDD）

### シナリオ 1: 素 storage 接触が 0 になる
- **Given** preset store と perSiteOverrides の実装
- **When** `chrome.storage.local` の直接参照を走査する
- **Then** 両ファイルに素接触が残っていない

### シナリオ 2: stale-overwrite 窓が縮小する
- **Given** preset 適用と migration の競合
- **When** repository lock 下で実行する
- **Then** 現行の epoch/busy-window guard と同等以上の安全性があり、テストで pin される

### シナリオ 3: preset 語義は不変
- **Given** 既存の preset / per-site テスト群
- **When** 移行後に実行する
- **Then** 無修正で緑である

## DoD（Definition of Done）

- [x] 両ファイルの素 storage 接触が 0 件になる
- [x] perSiteOverrides の load が targeted read になる
- [x] 既存テストが無修正で緑
- [x] `npm run type-check` / `npm run lint` / `npm test` が緑

## 実装記録（2026-09-23）
- presetSettingsAdapter を新設（read は blob→旧キー fallback、write は seam ロック下 delta のみ）。両ファイルの素 storage 接触 0 を grep で確認。stale 判定は seam 公開の getPort 経由。
- 検証: type-check / settings 32 ファイル 796 テスト緑（既存は無修正）。
