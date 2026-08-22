# PBI: vite modulePreload 回避策の棚卸し — 陳腐化検証

## ユーザーストーリー
開発者として、`wxt.config.ts:14` の `vite.build.modulePreload: false` が依然として必要か定期的に検証したい、なぜならこの設定はChrome MV3で `modulepreload <link>` が `cross-world extension resource mismatch` 警告を出すことへのworkaroundであり、wxt/vite/Chromeの更新で不要になれば除去すべきだが、検証が無いまま残り続けると将来の性能最適化（preload）の機会を失うから

## 優先度
- 順位: 12 / 12
- RICEスコア: 6.25 (Reach=5 / Impact=0.25 / Confidence=50% / Effort=0.10人月)
- 根拠: 開発者5人にのみ影響し、ユーザーへの影響はconsole warningの有無のみでImpact 0.25。wxt/viteの更新で自然に解消する可能性がありConfidence 50%。Effortは検証のみで最小。最下位だが棚卸しとして記録する価値あり。type=fixだがbacklog的

## ビジネス価値
- 保守性: 不要なworkaroundを除去し、将来のvite最適化（modulePreload）の恩恵を受けられる
- 品質: console warningの有無をCIで検出できれば、workaroundの要否を自動判定できる
- 測定: `modulePreload: false` を除去して `npm run build` し、Chrome拡張のエラーログに `cross-world` 警告が出るかで判定

## BDD受け入れシナリオ

```gherkin
Scenario: 正常系 — workaroundが依然として必要ならコメントとTODOが残る
  Given wxt.config.ts:14 に modulePreload:false がある
  When コードを検査する
  Then コメントに「なぜ必要か（cross-world mismatch）」と「検証条件（Chrome XX / wxt YY で再検証）」が記載されている
  And TODOに再検証のバージョン条件が明記されている

Scenario: 境界ケース — workaroundが不要になれば除去される
  Given modulePreload:false を除去してビルドした
  When Chrome拡張をロードし、エラーログを確認する
  Then cross-world警告が出ない
  And 拡張機能の全ページが正常にロードされる
  And modulePreload:false を除去したPRが作成される

Scenario: エラーケース — workaroundを除去して警告が再発すればrevertする
  Given modulePreload:false を除去した
  When Chrome拡張をロードする
  Then cross-world警告が再発する
  And 即時revertし、コメントに再検証日を追記する
```

## 受け入れ基準
- [ ] `wxt.config.ts:9-13` のコメントにworkaroundの理由と再検証条件が明記されている（現状は既にコメントあり、これを期限付きTODOに更新）
- [ ] 再検証の手順が `dev-docs/ADR/` またはコメントに記載されている（例: `modulePreload: false` を削除して `npm run build` し `chrome://extensions` のErrorsを確認）
- [ ] `package.json` の `wxt` / `vite` バージョン更新時に再検証する旨が `CONTRIBUTING.md` または Renovate設定に記載されている（任意）
- [ ] 除去検証の結果が本PBIに記録されている（必要/不要の判定と根拠）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 手動E2E: `modulePreload: false` を一時的に除去し、 `npm run build` 後にChromeで拡張機能をロード、 `chrome://extensions` のErrorsとService Workerのconsoleで `cross-world` 警告の有無を確認

### 統合テスト
- `wxt.config.ts` のvite設定が期待通りであることをスナップショットテスト（`modulePreload: false` の有無をassert）

### 単体テスト
- コメントの存在テスト: `wxt.config.ts` に `modulePreload` と `cross-world` のコメントが含まれることを `grep` で検証（軽量）

## 実装アプローチ
- **Outside-In**: E2E 警告再現テスト(手動) → 統合 設定スナップショットテスト(失敗) → 単体 コメント存在テスト(失敗) → 実装 → グリーン
- **Red-Green-Refactor**: TDDは軽量に。主は手動検証

## 見積もり
1pt（要チーム見積もり）— 検証とコメント更新のみの最小規模

## 技術的考慮事項
- 依存関係: なし。独立して実施可能。01-06のwxt.config.tsバッチに含めても良いが、検証は別途手動E2Eが必要
- テスタビリティ: 自動テストは困難（Chrome拡張のconsole警告をPlaywrightで検出するのは煩雑）。手動検証が主体
- 非機能要件: `modulePreload: false` はpreloadヒントを無効化するが、拡張機能の同一オリジンでは性能影響は無視できる（既存コメントにも `negligible, same-origin` と記載）
- 現状: `wxt.config.ts:9-13` に既に詳細コメントあり。対応としては「コメントに再検証期限を追記」するだけで十分な可能性
- 将来: wxtがこのworkaroundを内部で吸収すれば、設定自体が不要になる。wxtのCHANGELOGを定期確認

## 実装者向け注記

### 現状コードの確認
```bash
cat wxt.config.ts | head -20
grep -rn "modulePreload" wxt.config.ts package.json
cat package.json | grep -E "wxt|vite"
```

### 実装手順
1. 現状コメントを確認:
   ```ts
   // Chrome MV3 extension pages report modulepreload <link> tags as
   // "cross-world extension resource mismatch" warnings in the errors
   // console. The scripts still load fine via the entry's own <script
   // type="module">; disabling modulePreload only drops the (negligible,
   // same-origin) preload hint and removes the console noise.
   ```
2. コメントに再検証条件を追記:
   ```ts
   // TODO: Re-evaluate when wxt > 0.21.4 or vite > 8.1.5 or Chrome > 120.
   // To verify: remove this, run `npm run build`, load unpacked, check chrome://extensions Errors for "cross-world".
   ```
3. 手動検証（任意）:
   ```bash
   # 一時的に modulePreload: false をコメントアウト
   npm run build
   # dist/chromium-mv3 をChromeでLoad unpackedし、Errorsを確認
   ```
4. 警告が出なければ除去、出ればrevertし再検証日をコメントに記録

### 落とし穴
- `modulePreload: false` を除去すると `dist` の `manifest.json` には影響しないが、生成される `html` の `<link rel="modulepreload">` が復活する。Chromeの警告は `chrome://extensions` のErrorsタブでのみ確認でき、通常のconsoleには出ない場合あり — 必ず `chrome://extensions` の「Errors」ボタンから確認
- wxtのバージョンによっては `vite.build.modulePreload` の型が `false | { polyfill: boolean }` に変わる可能性。型エラーが出たらwxt docsを確認
- 本PBIは最下位のため、01-11の対応後に余裕があれば着手。単独でPRを作るほどの価値は低く、他PBIのwxt.config.ts変更時に併せてコメント更新するのが効率的

## Definition of Done
- [ ] 全BDDシナリオが手動で確認されている（自動テストは任意）
- [ ] コードレビュー完了（コメントの再検証条件をレビュー）
- [ ] リファクタリング完了（コメント更新のみ）
- [ ] ロールバック手段: コメントを元に戻すrevertで切り戻し可能
- [ ] ドキュメント更新済み（コメントに再検証条件を追記、またはADRに記録）
