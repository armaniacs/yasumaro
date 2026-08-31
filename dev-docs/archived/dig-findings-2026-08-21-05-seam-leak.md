# なぜなぜ分析 — background-dashboard-seam-leak

## 現象
`src/background/handlers/dashboardSqlite/deps.ts:2` が `from '../../../dashboard/obsidianFormatter.js'` を import しており、background 層が dashboard UI 層に依存している（seam leak）。

## 5 Whys
1. なぜ background が dashboard に依存しているのか → `append_to_obsidian` ハンドラで `formatEntriesToMarkdown` が必要だが、その実装が `dashboard/obsidianFormatter.ts` にしかなかったため
2. なぜ formatter が dashboard に置かれていたのか → 元々は dashboard の UI（preview/export）専用と考えられていたが、background の「Obsidian daily note 追記」機能が後から追加され、同じ整形が必要になったため
3. なぜ共用化されていなかったのか → 背景・dashboard 間の責務境界が曖昧で、markdown 生成が「UI 整形」か「ドメイン変換」かの分類が不明確だったため
4. なぜ background→dashboard の依存が問題なのか → dashboard は UI 層であり background はサービス層。dashboard の変更（UI リファクタ等）が background に波及し、予期しない regressions を起こす。LAYERS.md の依存方向（background → utils のみ）に違反するため
5. なぜ LAYERS.md の方向性が重要なのか → 依存方向を一方向に保つことで、変更の影響範囲を局所化し、保守者が「どこを変えたらどこが壊れるか」を予測しやすくするため

→ 解: `formatEntriesToMarkdown` と `formatSingleEntry` を `dashboard/obsidianFormatter.ts` から `src/utils/markdownFormatter.ts` に移動し、`dashboard/obsidianFormatter.ts` を utils への薄い re-export に縮小。`deps.ts` の import を utils に変更。既存テストが新 seam 越しにパスすることを検証する。
