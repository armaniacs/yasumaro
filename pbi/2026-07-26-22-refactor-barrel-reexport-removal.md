# PBI: バレル再エクスポートポリシー違反箇所を直接インポートに置き換える

**作成日**: 2026-07-26
**優先度**: Low
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🟡軽微（import文の変更のみだが、対象5ファイルすべての呼び出し元を洗い出す必要があり範囲が広い）

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Maintainability Guardian, DX Advocate（重複）からの指摘。「バレル再エクスポート禁止」ポリシーが以下5ファイルで守られていない: `src/utils/aiSummaryCleaner.ts`, `src/utils/contentExtractor.ts`, `src/utils/ublockParser.ts`, `src/background/aiClient.ts`, `src/popup/ublockImport.ts`。新規開発者が混乱し、WXTインクリメンタルビルドの恩恵を減じる。

**2026-07-26時点の調査で、`aiSummaryCleaner.ts` は単一ファイル（2103行）からモジュール分割された経緯があり、ファイル冒頭のコメントに「新しいモジュール構成」への分割が明記されていることを確認した。** これはバレル再エクスポートパターンである可能性が高い。CLAUDE.local.mdにも「モジュール分割時のルール」として `manifest.json` の `web_accessible_resources` 更新が必須と記載されており、この観点との整合性も確認する必要がある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
head -30 src/utils/aiSummaryCleaner.ts src/utils/contentExtractor.ts src/utils/ublockParser.ts src/background/aiClient.ts src/popup/ublockImport.ts
grep -rln "from.*aiSummaryCleaner\.js\|from.*contentExtractor\.js\|from.*ublockParser\.js" src/ | wc -l
```

各ファイルが実際にバレル再エクスポート（`export * from './xxx/yyy.js'` のようなパターン）になっているか、それとも単に同名のモジュールディレクトリと後方互換のための薄いラッパーなのかを確認する。`web_accessible_resources`（`manifest.json`）への影響も確認すること（CLAUDE.local.mdの既存ルール参照）。

## 受け入れ基準（BDD）

```gherkin
Scenario: 呼び出し元がサブモジュールを直接importする
  Given src/utils/aiSummaryCleaner.ts がバレル再エクスポートになっている
  When 呼び出し元のimport文を確認する
  Then aiSummaryCleaner.js ではなく、実際のサブモジュール（例: aiSummaryCleaner/helpers.js）を直接importするよう変更されている

Scenario: バレルファイル自体が削除または非推奨化される
  Given 全呼び出し元が直接importに移行した
  When バレルファイルの必要性を再評価する
  Then 外部（他パッケージ等）からの依存がなければバレルファイルを削除する

Scenario: manifest.jsonのweb_accessible_resourcesが整合する
  Given リファクタリング後のモジュール構成
  When manifest.jsonを確認する
  Then 実際に動的importされる全.jsファイルが列挙されている（CLAUDE.local.mdのルールに準拠）

Scenario: 既存のビルド・テストが回帰しない
  Given 直接import化した後のコード
  When npm run build && npm test を実行する
  Then 全て成功する
```

## 受け入れ基準
- [ ] 5ファイルそれぞれについて、実際にバレル再エクスポートパターンになっているか確認する
- [ ] 該当する場合、全呼び出し元のimport文をサブモジュール直接参照に変更する
- [ ] `manifest.json` の `web_accessible_resources` が実際のモジュール構成と一致しているか確認し、必要なら更新する
- [ ] `npm run build` と既存テストスイートが全てパスする
- [ ] バレルファイル自体を削除できる場合は削除し、削除できない場合（外部互換性のため残す等）は理由をコメントに残す

## テスト戦略

### 統合テスト
- `npm run build` でビルドが成功することを確認
- Content Scriptの動的インポートが正しく動作すること（`AGENTS.md` に記載の「Failed to fetch dynamically imported module」バグの再発がないこと）を手動確認

### 単体テスト
- 既存の各モジュール関連テストが全てパスする

## 実装アプローチ

1. 5ファイルそれぞれの実態（真のバレルか、後方互換ラッパーか）を確認
2. バレルパターンが確認できたファイルから順に、呼び出し元を直接import化
3. `manifest.json` の `web_accessible_resources` を更新
4. ビルド・テストで回帰確認

## 見積もり

3pt以上（5ファイル分の呼び出し元洗い出し + import変更 + manifest.json更新 + ビルド確認）

## 技術的考慮事項
- 依存関係: `manifest.json`（`web_accessible_resources`）
- テスタビリティ: 既存のビルド・テストプロセスが土台
- 非機能要件: ビルドパフォーマンス（WXTインクリメンタルビルド）、保守性

## Definition of Done
- [ ] 5ファイルの実態が確認されている
- [ ] 呼び出し元が直接importに変更されている（該当箇所のみ）
- [ ] manifest.jsonが更新されている
- [ ] ビルド・テストが全て成功する
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Maintainability Guardian, DX Advocate指摘、重複統合）
- 対象コード: `src/utils/aiSummaryCleaner.ts`, `src/utils/contentExtractor.ts`, `src/utils/ublockParser.ts`, `src/background/aiClient.ts`, `src/popup/ublockImport.ts`
- 参考: `CLAUDE.local.md`「モジュール分割時のルール」
