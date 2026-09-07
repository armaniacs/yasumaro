# PBI: テスト型債務返済 4/5 — popup + offscreen + content + testDir（704 errors / 73 ファイル）

> **開始前に必読**: `pbi/2026-09-07-08-test-type-debt-background.md` の「前提環境」「ベースラインゲートの仕様」「baseline.json の編集規約」「共通実装手順」「修復パターン（実例つき）」「禁止事項」「コミット規約」を読み、同一手順を適用すること（08 完了・アーカイブ後も `dev-docs/archived/pbi/` から参照可）。本ファイルはバッチ固有の差分のみを記載する。

## ユーザーストーリー

yasumaroの開発者として、`src/popup`（XSS・マスク可視化テスト含む）、`src/offscreen`（SQLite ワーカー）、`src/content`（抽出器）、および `testDir` 配下の E2E fixture に型チェックの生のゲートが効いてほしい。なぜなら、型債務の中には将来の実バグの予兆が含まれるから（シリーズ共通の背景は `pbi/00-INDEX.md` 参照）。

## 分析: 本バッチのスコープ（実測 2026-09-07、インベントリ = testDir/type-check-baseline.json）

- スコープ: **`src/popup/**` + `src/offscreen/**` + `src/content/**` + `testDir/**` の baseline エントリ** — 451 + 154 + 68 + 31 = 704 errors / 73 files
- 上位ファイル: `popup/__tests__/main.test.ts`(132)・`content/__tests__/extractor-comprehensive.test.ts`(49)・`offscreen/__tests__/sqliteMessageHandlers-coverage.test.ts`(46)・`popup/__tests__/mask-visualization.test.ts`(47)・`popup/__tests__/popup-xss.test.ts`(44)
- `testDir/**` は E2E fixture 6 ファイル（31 errors — popup.fixture.ts 10・popup-pbi27.fixture.ts 9・dashboard.fixture.ts 6 ほか）
- 依存なし・他バッチと並行可

## ビジネス価値

- ポップアップ（XSS 防御テスト含む）・SQLite ワーカー・コンテンツ抽出器に型レベルの実害検知を導入する
- E2E fixture（05/06 で拡充した共有資産）も型保護対象になる

## BDD受け入れシナリオ

```gherkin
Scenario: popup + offscreen + content + testDir 配下の型エラーが 0 になる
  Given 同配下の baseline エントリが全て返済されている
  When npm run type-check:test:raw を実行する
  Then 出力に同配下の error が 0 件である
  And 全 vitest がグリーン（実行時挙動不変）
```

## 受け入れ基準

- [ ] `src/popup/**` + `src/offscreen/**` + `src/content/**` + `testDir/**` が baseline から消滅
- [ ] baseline.json から返済済みエントリを削除
- [ ] 型レベル修正のみでテストの実行時挙動を変えない（全 vitest グリーン維持・E2E も挙動不変）
- [ ] 実装側の実バグ発見は別 PBI に切り出す（発見 0 件でもメモに記録）
- [ ] `npm run validate` が exit 0

## テスト戦略

### 単体テスト
- なし（既存テストの期待値を変えない）

### E2Eテスト
- fixture 修正は型レベルのみ。返済後に全 `@extension` E2E を1回実行して挙動不変を確認

## 実装アプローチ

1. `type-check:test:raw` の出力を同配下でフィルタし、エラー数の多い順に返済
2. 返済パターンは 2026-09-07-08 と同一（シリーズ共通 — INDEX セクション参照）
3. `popup/main.test.ts`（132 件）は段階分割を推奨（describe 単位で複数コミット）

## 見積もり

2pt（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: 2026-09-07-04（ベースラインゲート稼働中）が前提。08〜11 は互いに独立・並行可
- **テスタビリティ**: 1 ファイル返済のたび vitest run で挙動不変を確認。fixture 修正後は playwright --grep で関連 spec を流す
- **非機能要件**: 実行時挙動を変えないこと

## 実装者向け注記

### 現状コードの確認
```bash
npm run type-check:test:raw 2>&1 | grep -E "src/(popup|offscreen|content)|testDir" | cut -d'(' -f1 | sort | uniq -c | sort -rn | head -10
```

### 落とし穴
- **popup/main.test.ts の mock メソッド系（TS2339 ×多数）**: `vi.mock('...')` されたモジュール関数への `mockImplementation` は `vi.mocked(x).mockImplementation(...)` で包む。vi.mock ファクトリが返すオブジェクトの型は `vi.mocked` の深い推論に任せる
- **popup-xss.test.ts の期待値**: XSS 防御の回帰テスト — 期待値文字列は絶対に変更しない
- **testDir fixture（page.evaluate の境界）**: fixture 内のクロージャは page 内で直列化されるため、型はシリアライズ可能な値に限定（PagePayload のジェネリクス活用）

## Definition of Done

- [ ] popup + offscreen + content + testDir が baseline から消滅
- [ ] `npm run validate` exit 0
- [ ] コードレビュー完了
- [ ] 実装バグ発見の有無をメモに記録
