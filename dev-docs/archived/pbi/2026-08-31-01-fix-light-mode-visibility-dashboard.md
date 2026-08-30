# PBI: ライトモード視認性改善 — Dashboard AIプロバイダー設定のトークン準拠化

> **系統**: UI/デザイン（2026-08-31 起票）。VulnHunter セキュリティ修正（29 系）や
> クレンジング改善（30 系）とは独立。着手順・背景は
> [2026-08-31-00-backlog-ui-visibility.md](2026-08-31-00-backlog-ui-visibility.md) を参照。

## ユーザーストーリー
昼間のブラウザ（OSがライトモード）のユーザーとして、初期設定のAIプロバイダー設定（分離型Bの Priority / Provider Settings）が紙色のUIに自然に馴染み、コントラスト不足なく読めるようにしたい。なぜなら黒いハードコード背景がライトの紙背景に浮いて視認性を損ない、初期設定離脱とブランド（研墨）の一貫性を損なうから。

## ビジネス価値
- **ブランド一貫性**: 研墨テーマ（墨/紙/金）の世界観をライトでも維持。ライト時の紙色 `#f5f0e8` / 白 と、ダーク時の墨色を使い分ける
- **離脱防止**: 初期設定パネルは最初の接点。視認性不良による設定放棄を削減
- **測定方法**: ライト/ダーク両モードで手動目視チェック（スクリーンショット比較） + 自動 contrast チェック（WCAG AA 4.5:1 を満たすことを `axe` 相当の計算で検証）

## BDD受け入れシナリオ

```gherkin
Scenario: ライトモードでPriority行が紙色に馴染む
  Given OSが prefers-color-scheme: light で Dashboard を開いている
  When  初期設定タブの AIプロバイダー（B 分離型）セクションを表示する
  Then  Priority の各行（1/2/3）の背景は白または薄い紙色（var(--color-bg-white) / var(--color-bg-subtle)）で黒 (#27272a) ではない
  And   文字色は var(--color-text) 系で背景とのコントラストが 4.5:1 以上
  And   Provider Settings の各アコーディオンも同様にライト用トークンで表示される

Scenario: ダークモードの見た目は変わらない
  Given OSが prefers-color-scheme: dark で Dashboard を開いている
  When  同じセクションを表示する
  Then  Priority 行の背景は従来どおり暗色（ink系）が維持される
  And   文字色も従来どおりライトグレーでコントラスト 4.5:1 以上

Scenario: トグルと入力欄の整合性
  Given ライトモードで B 分離型を選択している
  When  A一体型/B分離型 トグル（ai-layout-toggle）とモデル名入力欄を見る
  Then  トグル背景は紙色系、入力欄は白背景で周囲のカードと同化せず区別できる
  And   フォーカスリングは var(--ym-focus-ring)（紫）が表示される（金ではない）

Scenario: エラーケース — ハードコード残存検出
  Given 修正後の dashboard.css
  When  `grep -n "#27272a\|#18181b\|#27272" entrypoints/options/dashboard.css` を実行する
  Then  該当するハードコードは 0 件
```

## 受け入れ基準
- [x] ライトモード（prefers-color-scheme: light）で B分離型の Priority 3行と Provider Settings 7アコーディオンが白/紙色ベースで表示される（スクショで黒浮きが解消）
- [x] ダークモードで従来の暗色見た目が維持される（リグレッションなし）
- [x] 主要テキストのコントラスト比が WCAG 2.1 AA（4.5:1）を満たす（--color-text on --color-bg-white 等）
- [x] ハードコード色（#27272a, #18181b, #3f3f46, #a78bfa の直値）が dashboard.css の該当3クラスから除去され ymトークン / --color-* に置換
- [x] 既存のユニット/統合テストがグリーンを維持
- [x] `npm run type-check` と `npm run validate` がパス

### 着地サマリ
- CSS トークン置換: PR #84（`9e240f60`）。`.b-priority-row` / `.b-provider-details` /
  `.b-provider-summary` / `.b-priority-handle` / `.ai-layout-toggle` を `--color-*` トークン化。
  `--color-*` は dashboard.css:95 の `@media (prefers-color-scheme: dark)` で反転するため、
  ライトは紙色（`#f8fafc` / `#ffffff`）、ダークは墨色（`#161b22` / `#0d1117`）を自動で使い分ける。
  別途 `@media` ブロックは不要。
- 単体テスト: `tests/dashboard/aiProviderBLightMode.test.ts`（PR #84）— CSS ソースの
  トークン使用と暗色直値の不在をアサート。
- E2E: `testDir/e2e/dashboard-light-mode.spec.ts` — ビルド後 options CSS を最小 DOM に適用し、
  `page.emulateMedia({ colorScheme })` で light/dark の `.b-priority-row` / `.b-provider-details`
  背景 computedStyle を検証（chromium + firefox で 6 ケース green）。
- ハードコード検出（BDD「エラーケース」）: `grep "#27272a\|#18181b\|#3f3f46"
  entrypoints/options/dashboard.css` → 0 件。ビルド後 `dist/**/options-*.css` の
  該当ルールも全て `var(--color-*)`。

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Playwright で `prefers-color-scheme` を light / dark に切り替えて Dashboard を開き、`.b-priority-row` と `.b-provider-details` の computedStyle.backgroundColor をアサート
  - light: `rgb(255,255,255)` または `rgb(248,250,252)`（--color-bg-white/subtle）であること
  - dark: `rgb(39,39,42)` 相当（ ink系 ）であること
- 目視回帰: light/dark のスクリーンショットを保存し、差分が意図どおり（ライトは明るく、ダークは維持）であること

### 統合テスト
- CSSトークン解決テスト: `getComputedStyle(document.documentElement).getPropertyValue('--color-bg-white')` が light/dark で期待値であること
- ハードコード検出テスト: ビルド後の `dist/**/dashboard.css` に禁止色が残っていないことを grep アサート（CIで実行）

### 単体テスト
- 既存 `priorityListView.test.ts` 等が影響を受けないことを確認（DOM生成ロジックはCSSのみ変更のため）
- 新規ユーティリティがあれば: コントラスト比計算ヘルパーの境界値テスト（#fff on #fff → 1:1 で失敗ケースなど）— 本PBIではCSSのみなら任意

## 実装アプローチ
- **Outside-In**: E2Eの「ライト背景が白である」失敗テストから開始 → 統合（トークン解決）→ CSS修正 → グリーン → リファクタリング
- **Red-Green-Refactor**: ハードコードをトークンに置換するたびに E2E を回し、段階的にグリーン化
- **リファクタリング**: グリーン後に `var(--ym-*)` と `var(--color-*)` の使い分けを DESIGN_TOKENS.md に照らして統一（操作要素は紫、金は装飾のみ）

## 見積もり
2pt（要チームでの見積もり） — CSS 3クラス + トグル1つのトークン置換、E2E 2ケース追加、目視確認

## 技術的考慮事項
- 依存関係: なし（独立。DESIGN_TOKENS.md / tokens.css は既存）
- 対象ファイル:
  - `entrypoints/options/dashboard.css` L4559-4604（`.ai-layout-toggle`, `.b-priority-row`, `.b-provider-details`, `.b-provider-summary`, `.b-priority-handle`）
  - `src/styles/tokens.css` は変更不要（既存 --color-* / --ym-* を再利用）
  - 必要なら `entrypoints/options/index.html` は触らない
- テスタビリティ: Playwright の `page.emulateMedia({ colorScheme: 'light' })` で再現可能。jsdom単体では `prefers-color-scheme` をエミュレートできないため E2E 必須
- 非機能要件:
  - WCAG 2.1 AA 4.5:1 を満たす配色（--color-text: #1e293b on #ffffff = 15.3:1 など既存トークンはクリア）
  - `prefers-reduced-motion` は既存トークンで担保済み、本変更でアニメーション追加なし
- 既存A一体型（`.priority-details`）は既にトークン準拠（L4172-）のため対象外。B分離型のみ修正

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# ハードコード色の残存確認
grep -rn "#27272a\|#18181b\|#3f3f46" entrypoints/options/dashboard.css src/styles/tokens.css
# トークン定義の確認
grep -n "color-bg-white\|color-bg-subtle\|color-border" src/styles/tokens.css entrypoints/options/dashboard.css | head -n 40
# B分離型のDOM生成箇所
grep -rn "b-priority-row\|b-provider-details\|ai-layout-toggle" src/ entrypoints/ --include="*.ts" --include="*.css"
```

既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。
- 調査結果（2026-08-30）: `b-priority-row` / `b-provider-details` / `ai-layout-toggle` の3クラスはハードコードでライト非対応。`priority-details`（A一体型）は既にトークン準拠のため本PBIでは除外。
- 未実装: ライト用 @media またはトークン置換。ダークは現状維持が必要。

### 実装手順
1. `dashboard.css` の該当ブロックを特定（L4559-4604）
2. ライト用（デフォルト :root）でトークン置換:
   ```css
   .b-priority-row {
     background: var(--color-bg-white);
     border: 1px solid var(--color-border);
   }
   .b-priority-row.has-error { border-color: var(--color-danger); }
   .b-priority-handle { color: var(--color-primary); }
   .b-provider-details {
     background: var(--color-bg-white);
     border: 1px solid var(--color-border);
   }
   .b-provider-summary { color: var(--color-text-secondary); }
   .ai-layout-toggle { background: var(--color-bg-subtle); }
   .ai-layout-toggle-btn { color: var(--color-text-muted); }
   .ai-layout-toggle-btn.active { background: var(--color-primary); color: #fff; }
   ```
3. ダーク用を `@media (prefers-color-scheme: dark)` で上書き（従来の #27272a 等をダークブロック内に移動）:
   ```css
   @media (prefers-color-scheme: dark) {
     .b-priority-row { background: #27272a; border-color: #3f3f46; }
     .b-provider-details { background: #18181b; border-color: #3f3f46; }
     .b-provider-summary { color: #e4e4e7; }
     .b-priority-handle { color: #a78bfa; }
     .ai-layout-toggle { background: #27272a; }
   }
   ```
   ※ 可能ならダークも ymトークン（--ym-color-ink-mid 等）に寄せるが、現行ダーク見た目維持が制約のため直値のダークブロック移設でも可。理想は `--ym-color-ink-mid` 等に置換。
4. Playwright E2E追加: `tests/e2e/dashboard-light-mode.spec.ts` で light/dark の backgroundColor をアサート
5. `npm run build && npm run validate` でリグレッション確認
6. 手動目視: OS設定を light/dark 切替 → Dashboard → スクリーンショット比較（本PBI冒頭の画像と見比べ、ライトで黒浮きが解消していること）

### 落とし穴
- **セレクタ詳細度の競合**: 既存のダークブロックが :root 直下にあると上書きされない。必ず `@media (prefers-color-scheme: dark)` 内で再定義すること
- **入力欄の白被り**: `.b-priority-row select/input` は既に `background: var(--color-bg-white)` なので、行自体を白にすると区別がつかない。行は `--color-bg-subtle`（#f8fafc）にし、入力欄は白のままにすると境界が明確になる
- **ハンドル色**: `#a78bfa` はダークでは見えるがライトでは薄すぎる。ライトは `var(--color-primary)`（#7c3aed）にするとコントラスト確保
- **ymトークン vs --color-* の使い分け**: 新規は `--ym-*` 推奨だが、dashboard.css 内では既に `--color-*` にエイリアスしているため `--color-*` で統一する方が差分が最小。`dev-docs/DESIGN_TOKENS.md` の移行方針と競合しないよう --color-* を使う
- **ビルド後のCSSパス**: WXTビルドで `dist/chromium-mv3/assets/dashboard-*.css` にハッシュ付与されるため、grepは `dist/` 配下を再帰的に探す

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（E2E light/dark + ハードコード検出）
- [x] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記 — 本PBIはCSSのみだがXSS/CSP観点で inline style 不使用を確認）
- [x] リファクタリング完了（グリーン後、トークン命名を DESIGN_TOKENS.md と整合。dashboard.css 内は `--color-*` で統一済み）
- [x] ロールバック手段の検討（CSS変更のため即時リバート可能。`--color-*` トークン参照を旧直値に戻すだけ。feature flag不要）
- [x] ドキュメント更新済み（DESIGN_TOKENS.md には B分離型固有の記載箇所がないため省略。本PBIの「着地サマリ」に集約）
