# PBI: pii-sandbox ハードコード除去 — 本番ログ汚染と露出防止

## ユーザーストーリー
開発者として、docsのPIIサンドボックスのデモコードが本番で自動実行されないようにしたい、なぜなら `docs/assets/pii-sandbox.js:9-14` の top-level でハードコードされたサンプルと `window.PiiSandbox` の即時実行が本番でも走り、コンソールログを汚染し、意図せぬAPI露出を招くから

## 優先度
- 順位: 8 / 12
- RICEスコア: 26.7 (Reach=10 / Impact=0.5 / Confidence=80% / Effort=0.15人月)
- 根拠: docs訪問者10人にのみ影響。ログ汚染は軽微だが恒久的に露出するためImpact 0.5。修正はdocs-src/pii-sandbox.tsの条件分岐で低工数。依存: 09 implicit global と10 window freeze と同ファイルのため同バッチ推奨、09→10→08の順で実施

## ビジネス価値
- 品質: 本番コンソールの不要ログを除去、デバッグ時のノイズ低減
- セキュリティ: デモ用のサンプルデータが本番で露出しない、攻撃者の挙動推測を困難に
- 測定: 本番ビルドの `docs/assets/pii-sandbox.js` をロードしても自動でサンプルが実行されず、コンソールに不要ログが出ない

## BDD受け入れシナリオ

```gherkin
Scenario: 正常系 — docsページで手動デモは動作する
  Given docsのPIIサンドボックスページを開いている
  When ユーザーがサンプルテキストを入力し「Sanitize」ボタンを押す
  Then PiiSandbox.sanitize() が呼ばれ、結果が表示される
  And ページロード時には自動でサンプルが実行されない

Scenario: 境界ケース — 開発環境ではデモが自動実行される（任意）
  Given NODE_ENV === 'development' または URLに ?demo=1 がある
  When ページをロードする
  Then デモサンプルが自動実行され、コンソールに結果が表示される（開発時のみ）

Scenario: エラーケース — 本番でtop-levelの即時実行が無い
  Given 本番ビルドの docs/assets/pii-sandbox.js を検査する
  When ファイルのtop-levelをパースする
  Then ハードコードされたサンプルテキストや console.log がtop-levelに存在しない
  And window.PiiSandbox の代入は条件付きまたは凍結されている
```

## 受け入れ基準
- [ ] `docs-src/pii-sandbox.ts` のtop-levelにハードコードされたサンプル実行が無い、または `if (import.meta.env.DEV)` 等の条件分岐で開発時のみに限定されている
- [ ] `docs/assets/pii-sandbox.js` の本番ビルド成果物に自動実行コードが含まれていない（`grep -n "sanitize.*example\|console.log" docs/assets/pii-sandbox.js` でtop-levelにヒットしない）
- [ ] docsページの手動デモは依然として動作する（ボタンクリックでsanitizeが実行される）
- [ ] `npm run build:docs-pii` 後の成果物が期待通り

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Playwrightでdocsページを開き、ページロード時にconsoleに不要ログが出ないことを確認
- ボタンクリックでsanitizeが動作することを確認

### 統合テスト
- `docs-src/pii-sandbox.ts` のビルド成果物を検査し、top-levelにサンプル実行が無いことをassert
- `esbuild` のバンドル結果をスナップショットテスト

### 単体テスト
- `docs-src/pii-sandbox.test.ts`（新規）で、開発/本番の分岐が正しく動作することをモックで検証
- `sanitize()` 関数自体のテストは既存 `src/utils/piiSanitizer.test.ts` でカバー、ここでは露出制御のみ

## 実装アプローチ
- **Outside-In**: E2E コンソール汚染テスト(失敗) → 統合 成果物検査テスト(失敗) → 単体 分岐テスト(失敗) → 実装 → グリーン
- **Red-Green-Refactor**: TDD

## 見積もり
1pt（要チーム見積もり）— 条件分岐の追加とビルド確認のみの小規模

## 技術的考慮事項
- 依存関係: 09 implicit global と10 window freeze と同ファイル。同バッチで09→10→08の順に実施するとtop-levelの整理が一度で完了
- テスタビリティ: `docs-src/pii-sandbox.ts` はESM、条件分岐は `import.meta.env.DEV` または `process.env.NODE_ENV` で可能だが、esbuildの `--define` に依存
- 非機能要件: 本番での不要実行を無くすことで、ページロード時の数msを節約（微小）
- 現状: `docs-src/pii-sandbox.ts` は15行で `sanitize` と `MAX_INPUT_SIZE` のexportのみ。指摘の `docs/assets/pii-sandbox.js:9-14` のハードコードは、旧版のビルド成果物に残った可能性。現行 `docs-src` にはハードコードが無いため、再ビルドで解消する可能性あり — 要現物確認

## 実装者向け注記

### 現状コードの確認
```bash
cat docs-src/pii-sandbox.ts
cat docs/assets/pii-sandbox.js | head -30
grep -n "example\|sample\|console\|window.PiiSandbox" docs-src/pii-sandbox.ts docs/assets/pii-sandbox.js
cat package.json | grep build:docs-pii
```

### 実装手順
1. 現状確認: `docs-src/pii-sandbox.ts` にハードコードが無ければ、指摘は旧成果物の残留。`npm run build:docs-pii` で再ビルドし、成果物にハードコードが残るか確認
2. 残る場合、 `docs-src/pii-sandbox.ts` を修正:
   ```ts
   // 開発時のみ自動デモ
   if (typeof window !== 'undefined' && new URLSearchParams(location.search).has('demo')) {
     sanitize('example: test@example.com').then(r => console.log(r));
   }
   export { MAX_INPUT_SIZE };
   ```
   または成果物側で `window.PiiSandbox` の公開を条件付きに
3. `npm run build:docs-pii && grep -n "demo\|example" docs/assets/pii-sandbox.js` で確認
4. docsページで手動テスト

### 落とし穴
- `docs/assets/pii-sandbox.js` は `esbuild --bundle --format=iife --global-name=PiiSandbox` の成果物。`--global-name` が `window.PiiSandbox` を自動生成するため、top-levelの `window.PiiSandbox =` を手書きしている場合は二重。esbuildの出力と手書きを混同しない
- `import.meta.env.DEV` は Vite固有。esbuildでは `process.env.NODE_ENV` または `--define:DEBUG=true` で分岐
- docsはGitHub Pagesで静的配信。クエリパラメータ `?demo=1` での分岐は、ブックマークや共有URLに影響しないよう注意

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ロールバック手段: 条件分岐を除去し旧top-level実行に戻すrevertで切り戻し可能
- [ ] ドキュメント更新済み（docsのPIIサンドボックスページに「?demo=1でサンプル実行」旨を追記する場合は更新）
