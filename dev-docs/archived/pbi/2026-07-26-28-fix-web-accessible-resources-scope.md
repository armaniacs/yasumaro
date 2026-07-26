# PBI: web_accessible_resourcesの全オリジン露出を実際に必要な範囲に制限する

**作成日**: 2026-07-26
**優先度**: High
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🔴あり（matchesを制限しすぎると、Content Scriptの動的インポートが失敗し全ページで自動保存が壊れるリスクがある。CLAUDE.local.mdに記載の過去の実障害と同種の失敗モード）

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Red Team Leader からの High指摘。`wxt.config.ts:58-73`（現状）で `chunks/*.js` や `assets/*.js` が `matches: ['http://*/*', 'https://*/*']`（全Webサイト）から読み取り可能になっている。内部ロジック・メッセージ形式・APIエンドポイントの解析、WASM バイナリの取得によるSQLite構造分析のリスクがある。

**2026-07-26時点の再調査で、この指摘は現在も有効であることを確認した。** `wxt.config.ts:58-73` に変更はなく、`chunks/*.js`, `assets/*.js` が依然として全オリジンに公開されている。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "web_accessible_resources" -A 20 wxt.config.ts
grep -rn "chrome.runtime.getURL\|import(" src/content/*.ts | head -20
```

**このPBIは`CLAUDE.local.md`に記載されている過去の実障害（`utils/foo.ts`分割時に`web_accessible_resources`更新漏れで「Failed to fetch dynamically imported module」エラーが発生し自動保存が全ページで失敗した、2026-04-15）と同種の失敗モードを持つ。** `matches` を制限する前に、Content Scriptが実際にどの `chunks/*.js`/`assets/*.js` を動的インポートしているかを完全に洗い出し、必要なファイルパターンを漏れなく維持すること。安易な制限は全ページでの動的インポート失敗という重大な回帰を招く。

## 受け入れ基準（BDD）

```gherkin
Scenario: Content Scriptが必要とする.jsファイルのみが公開される
  Given Content Scriptから動的importされる全.jsファイルのリスト
  When web_accessible_resourcesのresourcesを見直す
  Then 実際に動的importされるファイルパターンのみが残り、不要なワイルドカードパターン（例: 全chunks、全assets）が削減される

Scenario: matchesが実際にContent Scriptが注入されるページに限定される
  Given manifest.jsonのcontent_scripts.matchesと同等の範囲
  When web_accessible_resources.matchesを確認する
  Then content_scriptsのmatchesと整合する範囲に制限されている（全オリジンではなく、実際に必要な範囲）

Scenario: 制限後も全ページでの自動保存機能が正常動作する
  Given web_accessible_resourcesを制限した拡張機能
  When 実Chromeブラウザで複数の異なるドメインのページを開き自動保存機能を使う
  Then 「Failed to fetch dynamically imported module」エラーが発生せず、正常に動作する

Scenario: 外部サイトから内部バンドルが読み取れなくなる
  Given 制限後のweb_accessible_resources
  When 任意のWebページのJavaScriptから拡張機能の内部chunks/assetsを読み取ろうとする
  Then matchesの範囲外であればアクセスできない
```

## 受け入れ基準
- [ ] Content Scriptが実際に動的importする全 `.js` ファイルパターンを洗い出す（`chrome.runtime.getURL()` や `import()` の呼び出し箇所を全て確認）
- [ ] `web_accessible_resources.resources` を実際に必要なファイルパターンのみに絞る
- [ ] `matches` を `content_scripts` が注入される範囲と整合させる（全オリジンが本当に必要か、それとも `<all_urls>` である必然性があるか確認する。拡張機能の性質上、任意のページで記録を行うため `<all_urls>` 相当が必要な可能性が高いが、少なくとも `resources` 側は絞り込む）
- [ ] 実Chromeブラウザで複数の異なるドメインのページで自動保存機能が正常動作することを確認する（`AGENTS.md` の Manual Testing Required に従う）
- [ ] 既存のE2Eテスト（Playwright）が全てパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のPlaywright E2Eテストスイートを実行し、Content Script注入・動的インポートに関する回帰がないことを確認

### 統合テスト（手動、必須）
- 実Chromeブラウザで最低3種類の異なる構造・オリジンのWebページ（ニュースサイト、ブログ、SPA等）で自動保存機能を確認
- ブラウザのDevToolsコンソールで「Failed to fetch dynamically imported module」等のエラーが出ていないことを確認

## 実装アプローチ

1. `src/content/` 配下で `import()` や `chrome.runtime.getURL()` を使っている全箇所を洗い出す
2. 実際に必要な `chunks/*.js`, `assets/*.js` のサブセットを特定する（可能であれば具体的なファイル名列挙に近づける）
3. `wxt.config.ts` の `web_accessible_resources.resources` を絞り込む
4. ビルド後、実ブラウザで複数サイトでの動作確認を必ず実施する
5. 問題があれば `resources` の範囲を調整しながら進める（段階的に絞り込む）

## 見積もり

3pt以上（動的インポート箇所の完全な洗い出し + 段階的な絞り込み + 広範な実機確認）

## 技術的考慮事項
- 依存関係: `src/content/loader.ts`, `src/content/extractor.ts` 等の動的インポート箇所
- テスタビリティ: 自動テストでは検出しづらい実行時エラーのため、実ブラウザでの手動確認が必須
- 非機能要件: セキュリティ（内部バンドルの露出防止）

## Definition of Done
- [ ] 動的インポート箇所が完全に洗い出されている
- [ ] web_accessible_resourcesが絞り込まれている
- [ ] 実ブラウザでの複数サイト動作確認が完了している（回帰なし）
- [ ] 既存のE2Eテストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Red Team Leader指摘、High）
- 対象コード: `wxt.config.ts:58-73`
- 参考: `CLAUDE.local.md`「モジュール分割時のルール」（web_accessible_resources更新漏れによる過去の実障害、2026-04-15）

## 実装メモ（2026-07-26完了）

`src/content/*.ts`（Content Script実行コンテキスト）からの`chrome.runtime.getURL()`/動的`import()`
呼び出しを全て洗い出した結果、外部Webページから実際に必要なリソースは以下の2つのみと判明した:

- `content-extractor.js`（`loader.ts`が`import()`で動的取得）
- `icons/icon48.png`（`extractor.ts`のプライバシー確認ダイアログで`<img>`表示用）

残り7パターンは全て拡張機能内部コンテキスト（popup/dashboard/permissionsページ）からのみ
利用されており、`chrome-extension://`オリジン内は`web_accessible_resources`の制約を受けないため
宣言不要と判明した:

- `content-scripts/content.js`: `manifest.json`の`content_scripts`セクションで既に宣言されており
  ブラウザが自動注入するファイル。`web_accessible_resources`への重複宣言だった
- `chunks/*.js`, `assets/*.js`: `content-extractor.js`は静的importのみでビルドされる自己完結
  バンドルであり、ビルド後の成果物を`grep`しても`chunks/`への参照はゼロ
- `data/models-dev-openai-compatible.json`: `src/utils/modelsDevApi.ts`（popup/dashboard専用）から
  `fetch(chrome.runtime.getURL(...))`
- `PRIVACY.md`: `src/privacy/privacy.ts`（`entrypoints/permissions/`配下の独立ページ）から`fetch()`
- `permissions.html`: `src/popup/privacyConsentController.ts`から`chrome.runtime.getURL()`でリンク先
  として使用
- `assets/permissions-*.css`: `permissions.html`自身が`<link>`で読み込む静的アセット

`wxt.config.ts`の`resources`を9パターンから2パターンに絞り込み。検証:
- `npm run build`成功、生成`manifest.json`で意図通り2パターンのみになったことを確認
- 単体テスト全7269件パス
- Playwright E2E全183件パス（2件は既知の条件付きスキップ）。特に`@extension`プロジェクト
  （実Chromiumで拡張機能をロード）の`content-script-recording.spec.ts`5件が全てパスし、
  動的import・`VALID_VISIT`発火まで正常動作を確認
- 変更前後を`git stash`で比較し、テスト中に見えた`[page error] 404`警告は今回の変更と無関係の
  既存挙動と確認済み
- ユーザーによる実Chromeブラウザでの手動確認（複数サイトでの動的importエラー有無、
  `chrome-extension://`への直接fetchでの絞り込み確認）完了、問題なしと報告あり
