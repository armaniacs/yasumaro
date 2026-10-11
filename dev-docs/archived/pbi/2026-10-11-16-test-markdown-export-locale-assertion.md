# PBI: Markdown export E2E のロケール依存アサーションを直す

- 種別: test
- RICE: 2.4（R3 × I1 × C0.8 / E1.0）
- 依存: なし
- バッチ: usability-followup
- 台帳: `pbi/2026-10-11-00-backlog-usability-followup.md`
- 出所: headed E2E 失敗（2026-10-11 ユーザー実行、`dashboard-markdown-export` が extension/usability 両 project で red）

## ユーザーストーリー

E2E 担当者として、ブラウザの UI 言語によらず export 検証を green にしたい。
なぜなら現状は日本語 UI 環境で決定的に red になり、CI 以外の headed 実行が
全滅扱いになるから。

## 優先度

- 順位: 1 / 2
- RICEスコア: 2.4（Reach=3 / Impact=1 / Confidence=0.8 / Effort=1.0）
- 根拠: ja 環境で確定 red（再実行でも同一失敗）。アプリ側は正しくローカライズ
  されているため spec 側の問題と見込む。修正は spec/fixture 内に閉じる見込み。

## 背景（現状・証拠）

- `testDir/e2e/usability/dashboard-markdown-export.spec.ts:36` —
  `await expect(page.locator('#export-status')).toContainText(/completed/i)`。
- 実測（失敗ログ）: 同 locator は `<div id="export-status" class="status-message success">Markdown エクスポートが完了しました。</div>` と空 div を交互に解決。
  日本語文言に Latin の "completed" は含まれないため、ja UI では成立不能。
- アプリ側: `src/dashboard/panels/diagnostic/exportLogsPanel.ts:40` —
  `getMessageOr('exportLogsMarkdownCompleted', 'Markdown export completed.')`
  で i18n 解決しており、日本語表示は正動作。NN08 差分は dashboard/export/i18n
  に触れていない（無関係を確認済み）。
- fixture（`testDir/e2e/fixtures/dashboard.fixture.ts`）は locale を固定していない。

## BDD 受け入れシナリオ

```gherkin
Scenario: 日本語 UI でも export 検証が通る
  Given ブラウザ UI が日本語の headed 環境
  When export spec を実行する
  Then ダウンロード内容の検証まで green になる

Scenario: 英語 UI でも回帰しない
  Given ブラウザ UI が英語の環境（CI 相当）
  When export spec を実行する
  Then 従来通り green のまま
```

## 受け入れ基準

- [ ] ja / en 両 UI 言語で `dashboard-markdown-export` が green（両 project）
- [x] 修正方針を以下から裁定し PBI に記録する: (a) fixture/spec で locale を en-US に固定 (b) `.success` クラス＋非空テキスト等のロケール非依存アサーション (c) ブラウザ `--lang` 駆動
  → 当初 (a) で実装（`test.use({ locale: 'en-US' })`）したが headed 実行でも
  UI が日本語のまま red 継続。`test.use`→shared→`--lang` 配線は正しいため、
  Chromium 側で `--lang` が extension i18n に反映されないと確定。
  よって **(b) に変更**: `toContainText(/completed/i)` を
  `toHaveClass(/success/)` に置換し、無効と判明した locale pin は除去。
  成功表示は 3 秒間出る（`showStatus` 実コード）ため poll で捕捉可能。
  前回失敗 run でも success 状態を 10 回観測しており確度は高い。
- [x] NN04 のロケール判定統一（`a8f1daba`）と矛盾しないこと（アプリ側の判定は不変。spec の実行条件のみ固定）
- [x] `npm run validate` が green（最終フル検証で確認する→ 1059 files green で確認）

## テスト戦略

- E2E: 当該 spec を ja / en 両条件で実行（headed 必須）。
- 回帰: ダウンロード内容の検証（`Markdown Export Target Page` 含有）は不変。
- unit 不要（spec のみの変更見込み）。

## 見積もり

1.0 SP（方針裁定 0.5＋修正・両言語確認 0.5）

## 技術的考慮事項

- `launchExtensionContext` は `locale` オプション透過に対応済み（`--lang` 併用）か要確認。対応済みなら (a) が最短。
- (b) を選ぶ場合、成功表示の有無と文言の中身を分離する（`.status-message.success` の出現＋ダウンロード実体の検証で十分な可能性）。
- `task-friction-metrics` の同系統テスト（NN17）とは独立に閉じられる。

## 実装者向け注記

### 実装手順

1. 方針 (a)/(b)/(c) を裁定する
2. 失敗する条件（ja）で Red を確認 → 修正 → Green
3. en 条件で回帰確認、`npm run validate`

### 落とし穴

- ステータス文言は表示後にクリアされる（ログで success→空の往復を確認）。ポーリング条件にすること
- テストで実時間待ちを入れない

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npm run validate` が green
- [x] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする

## 検証結果（2026-10-11 autonomous-task-closer）

- 実装: `toContainText(/completed/i)` → `toHaveClass(/success/)` に置換
  （経緯は受け入れ基準の方針裁定欄を参照。(a) 実装→headed で無効を確認→(b) へ）
- `npm run type-check:test:baseline` — 463（pinned 463、exit 0）
- `npx eslint` exit 0
- headed E2E は未検証。ユーザー headed 実行待ち。
  本 PBI は E2E green 確認後にアーカイブする（NN08 と同一基準）
- 追記（headed E2E green）: 当該 spec のみ実行し 2 passed（extension＋usability
  両 project）。NN17（friction hang）は別件として残置。
