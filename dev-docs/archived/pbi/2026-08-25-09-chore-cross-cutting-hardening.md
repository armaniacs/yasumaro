# PBI: 横断的ハードニング（CSP/i18n/alarm/PII/依存/eslint）を一掃する

## ユーザーストーリー
開発者として、レビューで指摘された横断的な小粒の指摘を一括で解消したい、なぜなら個別では Low だが束ねるとユーザ体験とセキュリティ監査での減点要因になり、まとめて潰すことで次のリリースをクリーンにしたいから

## 優先度
- 順位: 9 / 9
- RICEスコア: 6.1（Reach=7 / Impact=0.5 / Confidence=70% / Effort=0.40w）
- 根拠: 個別 Impact は小だが Reach は広い。Effort が分散するため最後にまとめて実行。依存なし。

## ビジネス価値
- CSP エラー時の空白画面、i18n の `__MSG_xxx__` 露出、alarm 多重発火など、ユーザが気づく小バグを 8件同時に解消できる
- 依存の `npm audit` と eslint layer ルールで将来の債務を自動検出できる

## BDD受け入れシナリオ

```gherkin
Scenario: CSP エラー時に UI でエラーが表示される
  Given dashboard の CSP が違反している
  When options ページを開く
  Then statusPanel に「CSP エラー: 設定を再読込してください」が表示される

Scenario: i18n キー欠落が CI で検出される
  Given en/messages.json にキーを追加したが ja に追加し忘れる
  When `npm run lint:i18n` を実行する
  Then CI が失敗し、欠落キーが表示される

Scenario: alarm が多重登録されない
  Given Service Worker が再起動する
  When alarmHandler が再登録される
  Then chrome.alarms.getAll で reviewSummary alarm が 1件のみである

Scenario: PII パターンがログに平文で出ない
  Given カスタムパターンに `mySecret123` を含める
  When stripExtended がログを出力する
  Then ログにはハッシュまたは truncate された値のみが出る
```

## 受け入れ基準
- [x] `entrypoints/options/index.html` の CSP 変更で違反時のフォールバック表示がある
- [x] `public/_locales/en|ja/messages.json` のキー集合差分を CI で検出（`npm run lint:i18n`）
- [x] `src/background/alarmHandler.ts` で登録前に `chrome.alarms.clear` するか冪等な登録になっている
- [x] `src/utils/aiSummaryCleaner/stripExtended.ts` のカスタムパターンログがハッシュ/truncate されている
- [x] `package.json` の依存で `npm audit` High 以上が 0
- [x] `eslint.config.js` で `import/no-restricted-paths` の layer ルールが有効
- [x] カスタムプロンプトのエラーメッセージが i18n 化されている

## テスト戦略

### E2Eテスト
- CSP 違反時の UI 表示を Playwright で検証
- i18n キー欠落時の CI 失敗を手動で再現

### 統合テスト
- alarmHandler の多重登録テスト（2回連続登録で alarm 数が 1）
- PII ログのハッシュ化テスト

### 単体テスト
- `lint:i18n` スクリプトの unit test
- `isAllowedProviderUrl` とは別に、PII マスキングの unit test

## 見積もり
3pt

## 技術的考慮事項
- 依存関係: なし。ただし 08 の messageTypes 整理後に実行すると eslint ルールと整合
- 非機能要件: 本 PBI は 8小項目の束ね。1つでも失敗すると全体が revert されやすいため、コミットは小項目ごとに分割する

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "cspSettings\|wasm-unsafe-eval" src/dashboard/ entrypoints/
grep -rn "messages.json" public/_locales/en/messages.json public/_locales/ja/messages.json | head
grep -rn "chrome.alarms" src/background/alarmHandler.ts
grep -rn "stripExtended\|customPatterns" src/utils/aiSummaryCleaner/
cat eslint.config.js
npm audit --audit-level=high
```

### 実装手順
1. `cspSettings.ts` で CSP 生成後に自己診断し、statusPanel にエラー表示
2. `scripts/lint-i18n.ts` を追加し en/ja のキー差分を検出、CI に組み込み
3. `alarmHandler.ts` で `await chrome.alarms.clear("reviewSummary")` を登録前に追加
4. `stripExtended.ts` のログで `piiSanitizer` を適用または `pattern.slice(0,20)+hash` に
5. `eslint.config.js` で `import/no-restricted-paths` を復活させ、`npm audit fix` を実行

### 落とし穴
- CSP の自己診断を `chrome.runtime.getURL` で行うと、開発環境と本番で URL が異なる。`chrome.runtime.getManifest()` の CSP 取得で代替する
- i18n lint を `npm run lint` に含めると既存の lint が失敗する。`lint:i18n` として分離し、CI の別ステップで実行する

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npm run lint` と `npm run lint:i18n` が PASS
- [x] `npm audit` High 以上が 0
- [x] コードレビュー完了
- [x] ドキュメント更新済み（docs/SETUP_GUIDE, CONTRIBUTING の i18n/CSP 章）
