# PBI: CSPテンプレートのビルド時検証 — 不正値の静かな破綻防止

## ユーザーストーリー
開発者として、CSP文字列の生成時に不正な値が混入したらビルドが即時失敗してほしい、なぜなら `wxt.config.ts:67` のテンプレートリテラルは `buildConnectSrcDomains()` の戻り値を無検証で埋め込むため、無効なdomain（空文字・スキーム欠落・スペース含み）が混入するとCSP全体が無効化し全通信がブロックされるのに気づかずリリースされるから

## 優先度
- 順位: 3 / 12
- RICEスコア: 1250 (Reach=500 / Impact=1 / Confidence=50% / Effort=0.20人月)
- 根拠: CSP破綻は全ユーザーで拡張機能が無通信になる重大障害だが、buildConnectSrcDomains()が現状正常なため発生確率は中。検証は低工数で恒久対策。依存: 01/04のCSP変更の前提として先行すると安全

## ビジネス価値
- 信頼性: CSP破綻による「AI providerに一切接続できない」障害をビルド時に検出、リリース前ブロック
- 開発効率: CSPエラーは実行時にしか気づきにくくデバッグが困難。ビルド時エラーで即時フィードバック
- 測定: 不正domainを注入したテストで `npm run build` が非ゼロ終了し、エラーメッセージに該当domainが含まれる

## BDD受け入れシナリオ

```gherkin
Scenario: 正常系 — 正常なdomainリストでビルドが成功する
  Given buildConnectSrcDomains() が https://api.openai.com 等の正常なリストを返す
  When npm run build を実行する
  Then CSP検証がパスし、dist/**/manifest.json のCSPに全domainが含まれる
  And 拡張機能のAI接続が正常に動作する

Scenario: エラーケース — 不正なdomainでビルドが失敗する
  Given buildConnectSrcDomains() が '' や 'api.openai.com' (スキーム無し) や 'https://evil domain.com' を返す（テストでモック）
  When CSP検証を実行する
  Then ビルドが失敗し、エラーメッセージに不正domainと理由（empty/scheme missing/space）が含まれる
  And dist/manifest.json は生成されないか、CSP無しで生成されない
```

```gherkin
Scenario: 境界ケース — 空配列でも安全にフォールバックする
  Given AI_PROVIDER_HOST_PERMISSIONS が空配列
  When CSPを生成する
  Then connect-src は 'self' + local ports のみで構成され、末尾スペースや二重スペースを含まない
  And CSPのパースが成功する
```

## 受け入れ基準
- [ ] `src/utils/cspDomains.ts` または `wxt.config.ts` にCSP検証関数 `validateCspDomains()` が存在する
- [ ] 検証項目: 非空文字、スキーム `https://` 必須、スペース・改行・`'`・`;` を含まない、URLとしてパース可能
- [ ] `wxt.config.ts` の `content_security_policy.extension_pages` 生成前に検証が呼ばれ、不正時はthrowする
- [ ] 単体テストで不正domainごとのエラーメッセージが検証されている
- [ ] `npm run build` が検証を含む（wxtのviteフック or 事前スクリプト）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 不正domainを含むブランチで `npm run build` が失敗することをCIログで確認（手動E2E相当）

### 統合テスト
- `validateCspDomains(['https://api.openai.com', ''])` がthrow、`['https://api.openai.com']` がpassすることを検証
- `wxt.config.ts` のmanifest生成をモックdomainで呼び出し、CSP文字列が期待通りか検証

### 単体テスト
- `src/utils/cspDomains.test.ts` に追加:
  - 空文字 → error
  - スキーム無し → error
  - スペース含み → error
  - 正常domain → pass
  - 空配列 → pass（localのみ）
- CSP文字列のパーステスト: `connect-src` に二重スペースや末尾スペースが無い

## 実装アプローチ
- **Outside-In**: 統合 不正domainでbuild失敗テスト(失敗) → 単体 validate関数テスト(失敗) → 実装 → グリーン
- **Red-Green-Refactor**: TDD

## 見積もり
2pt（要チーム見積もり）— 検証関数は小規模だが、wxt.config.tsのビルドフックへの組込みとテストが含まれる

## 技術的考慮事項
- 依存関係: 01 CSP port restriction, 04 wasm-unsafe-eval と同バッチで先行実施。検証が無いと01の修正時に不正CSPを埋めるリスク
- テスタビリティ: `validateCspDomains` は純関数としてテスト容易。wxt.config.ts側は `defineConfig` の戻り値生成をテスト
- 非機能要件: ビルド時間への影響は無視できる（数ms）
- 既存資産: `src/utils/cspDomains.ts` は既に `buildConnectSrcDomains()` を提供。ここに `validateCspDomains(domains: string[])` を追加するのが自然

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "buildConnectSrcDomains" wxt.config.ts src/utils/cspDomains.ts
cat src/utils/cspDomains.test.ts 2>&1 | head -100
grep -rn "content_security_policy" wxt.config.ts
```

### 実装手順
1. `src/utils/cspDomains.ts` に追加:
   ```ts
   export function validateCspDomains(domains: string[]): void {
     for (const d of domains) {
       if (!d || !d.startsWith('https://')) throw new Error(`Invalid CSP domain: ${d}`);
       if (/\s|;|'/.test(d)) throw new Error(`Invalid CSP domain (contains forbidden char): ${d}`);
       try { new URL(d); } catch { throw new Error(`Invalid URL: ${d}`); }
     }
   }
   export function buildValidatedConnectSrc(): string {
     const domains = buildConnectSrcDomains();
     validateCspDomains(domains);
     return domains.join(' ');
   }
   ```
2. `wxt.config.ts:67` で `buildValidatedConnectSrc()` を使用、または `validateCspDomains(buildConnectSrcDomains())` を先に呼ぶ
3. `src/utils/cspDomains.test.ts` に不正系テスト追加
4. `npm run build` で正常系パスを確認

### 落とし穴
- `http://localhost:27123` は `http` スキームだが、AI providerは `https` のみ。validateは両方許容するか、localとproviderで分ける
- `buildConnectSrcDomains()` は `/*` をstrip済み。strip前の `https://api.openai.com/*` をvalidateすると `/*` でURLパースが微妙に異なる — strip後にvalidateすること
- wxtの `defineConfig` は同期/非同期どちらも可能。validateでthrowするとwxtのエラーハンドリングに乗るか確認（`npm run build` で実際に不正値を入れて試す）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了（バリデーションの網羅性をレビュー）
- [ ] リファクタリング完了
- [ ] ロールバック手段: validate呼び出しをコメントアウトで即時切り戻し可能（ただし推奨しない旨をPRに記載）
- [ ] ドキュメント更新済み（dev-docs/DESIGN_SPECIFICATIONS.md にCSP生成の検証ステップを追記）
