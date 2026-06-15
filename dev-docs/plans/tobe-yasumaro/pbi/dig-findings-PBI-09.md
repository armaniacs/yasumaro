# 深掘りセッション — PBI-09: デザインシステム確立（和モダン・精緻テーマ）

> 日付: 2026-06-16
> 対象: `dev-docs/plans/tobe-yasumaro/pbi/2026-06-10-09-feat-design-system.md`

---

## 挑戦した仮定

| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| CSS のみの変更で全 UI を刷新できる | 高 | `appConstants.ts` にスピナー色 `#4CAF50` など TS 定数あり。CSS のみではスピナーが緑のまま | **Phase D で TS 定数も対応**（CSS のみから逸脱するが許容） |
| `--ym-*` トークン移行が段階的に可能 | 高 | dashboard.css 全 3,458 行、`--color-*` が散在。全置換は膨大 | **変数定義のみ先行（Phase A）、セレクタ置換は後続PBI** |
| dashboard と popup の変数分離は問題ない | 中 | `:root` ブロックが dashboard と popup で独立コピー。後から統合コストが膨大 | **共通 `src/styles/tokens.css` に定義し両方から読み込む** |
| models-dev-dialog.css / privacy.css は無視できる | 中 | models-dev-dialog の primary は `#007bff`（完全乖離）、privacy.css は独自変数 | **primary 色のみ置換する** |
| ポップアップは別 PBI で対応で良い | 中 | ユーザー初回体験はポップアップ。色の統一感に影響 | **ポップアップは対象外、ダッシュボードのみ** |
| 金箔アクセントを全操作要素に使える | 高 | 紫 → 金の変更で「押せる」の直感的認識が変わるリスク | **金は装飾のみ（ナビアクティブ・フォーカスリング）、ボタン等は紫維持** |
| 段階移行中は `--color-*` と `--ym-*` が混在して良い | 低 | 計画通り。Dashboard 内の段階移行として許容 | **計画通り** |
| stagger animation が 60fps を維持できる | 中 | CSS animation のみ。パフォーマンスリスクは低い | **計画通り、実装後に DevTools 確認** |

---

## 新たに発見したリスク

1. **`appConstants.ts` の色定数ドリフト**: `UI_COLORS.spinner` が `#4CAF50`。Phase D で修正しないとスピナーだけ緑のまま
2. **`--radius-md` が未定義**: `.domain-mode-tab`, `.settings-section` で参照されているが `:root` に定義なし。既存 UI の表示が崩れている可能性
3. **`--space-7` が不足**: スペーシングスケールに 28px のギャップ
4. **models-dev-dialog.css の primary `#007bff`**: アプリ全体の primary `#7c3aed` と完全に乖離。Store スクリーンショットに映る可能性
5. **tokens.css の新規作成**: WXT エントリポイントへの CSS 追加方法の確認が必要（wxt.config.ts の設定）

---

## 決定事項

1. **移行戦略**: 段階的。Phase A で `--ym-*` 変数定義のみ行い、既存セレクタの置換は後続PBI
2. **スコープ外 CSS**: models-dev-dialog.css / privacy.css の primary 色のみ置換（追加工数 0.5〜1SP）
3. **ポップアップ**: PBI-09 では対象外。ダッシュボードのみ
4. **金箔アクセント**: 装飾要素（ナビアクティブ・フォーカスリング）に限定。操作要素（ボタン・リンク）は紫（`--color-primary`）維持
5. **トークン共有**: dashboard.css 内に定義せず、`src/styles/tokens.css` として新規作成し dashboard/popup 両方から読み込む
6. **appConstants.ts**: Phase D でスピナー色等を `--ym-*` に対応させる（CSS のみから逸脱するが許容）

---

## PBI-09 計画の修正点

| 項目 | 旧計画 | 新決定 |
|------|--------|--------|
| 変数定義場所 | `dashboard.css :root` | **`src/styles/tokens.css`**（新規ファイル） |
| スコープ外 CSS | 完全無視 | models-dev-dialog / privacy の primary のみ置換 |
| appConstants.ts | 対象外 | Phase D で対応 |
| 金箔の使用範囲 | プライマリアクセント全般 | 装飾限定、操作要素は紫維持 |
| ポップアップ | 別PBI | 別PBI（変更なし） |

---

## 未解決の疑問

1. WXT で `src/styles/tokens.css` を dashboard / popup 両方から読み込む方法（wxt.config.ts の `css` 設定？）
2. Phase B〜D のスコープをどこまで細分化するか（本深掘りの決定事項を反映した見積もり再計算）

---

## 完全性チェック

- [x] 高リスク仮定がすべて調査された（CSS-only → TSも必要、gold-primary → 装飾限定）
- [x] 各主要トピックで2段階以上深掘りした（移行戦略→スコープ外CSS→ポップアップ、金箔→TS定数）
- [x] すべての決定が記録された（6件）
- [x] 新たに浮かんだリスクが追跡された（5件）
- [x] 未解決の疑問が明示された（2件）
