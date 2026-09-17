# Backlog 台帳: arch-delivery-loop 第5ループ (2026-09-18)

Phase 0 診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260918-r18.html`）の候補を RICE 採点した台帳。直近4ラウンドで主要摩擦は解消済みのため候補は2件。

## RICE スコア表（降順 = 実行順）

| 順位 | 候補 | Reach | Impact | Confidence | Effort | RICE | ファイル |
|------|------|-------|--------|------------|--------|------|----------|
| 1 | C1: 理由行 push 重複と cleansing bytes 解決の二重所有を seam 化 | 4 | 0.5 | 80% | 0.2 | 8.0 | sqliteHistoryPanelView.ts, historyEntryPresentation.ts |
| — | C2: getMessage 直呼び散在の getMessageOr 統一（backlog送り） | 20 | 0.25 | 50% | 1.0 | 2.5 | resultBuilder.ts, notificationHelper.ts, errorUtils.ts ほか |

RICE = (Reach × Impact × Confidence) / Effort。Impact 基準: 3=圧倒的 / 2=大 / 1=中 / 0.5=小 / 0.25=極小。

## 依存グラフ

- C1 → 依存なし。前日実装（PBI 2026-09-18-01）の直上で drift 可能なうちに seam 化する
- C2 → 依存なし。ただし service worker と popup の chrome 依存境界の整理が前提になるため今回は見送り、将来候補として残す

## 5 Whys サマリー

- C1: なぜ理由行の変更が4箇所編集になるのか → 同一 push 文が if/else 両腕に複製されているから。なぜ解決が二重なのか → `original ?? candidate` が View と classifier に別々に書かれているから。解: push 用 seam と bytes 解決 seam を新設し両者から使う
- C2: なぜ文言方針が分裂し得るのか → `getMessage(k) || fallback` が約20箇所に inline だから。ただし挙動差異は未観測であり、境界整理が先行課題のため backlog 送りとした

## 調査済み・対象外

- `.then()` 残存は lazy import・promise queue・テストのみで正当
- `new SettingsRepository()` は PBI 06 で統制済み（lint 再発防止あり）
- ネイティブ confirm()/alert() は PBI 19 で統一済み
- atob/btoa 直書きは crypto seam 集約済み（kdfNegotiator の1箇所は互換性のため意図的残置）

## PBI 一覧

- `2026-09-18-02-refactor-history-reason-row-seam.md`（C1、RICE 8.0、実装対象）
