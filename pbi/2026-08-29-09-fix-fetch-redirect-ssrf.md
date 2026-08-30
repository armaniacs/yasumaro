# PBI: FETCH_URL リダイレクト再検証 — SW 経由 SSRF 封鎖（VULN-016, CWE-918）

## ユーザーストーリー
利用者として、フィルタリスト import の URL が検証後に private IP へリダイレクトしても、Service Worker が内部ネットワークの応答を取得・返却しないようにしたい、なぜなら SSRF ガードは初期 URL のみを検証し、fetch がリダイレクトを黙って追跡するから

## ビジネス価値
- 実証済み攻撃の封鎖: 許可 URL → 30x リダイレクト → `http://127.0.0.1:9222` の body が返却される（拡張ページからは直接到達できない private IP への SW 仲介アクセス — 明確な新 capability）
- fetch.ts に hop-level 検証規約を作り、将来の攻撃者影響 URL fetch にも適用可能にする
- 測定方法: FETCH_URL のリダイレクト再現テスト（許可 URL→30x→private IP）が失敗すること、17 fetch サイトのうち攻撃者影響 URL を持つ FETCH_URL が全ホップ検証を通ること

## 優先度
- 順位: 9 / 14
- RICEスコア: 1000（Reach=300 / Impact=0.35 / Confidence=95% / Effort=0.1人月）
  - Reach 300: FETCH_URL は extension-only。ただし悪意あるフィルタ URL の import（ユーザーが張り替えた供給元）で発火
  - Impact 0.35: private IP 応答の取得（SW 経由でのみ可能な新 capability）
  - Confidence 95%: `redirect: 'error'` 1 行で塞げる。スイープで 17 fetch サイト中攻撃者影響 URL は 1 箇所のみと確認済み
  - Effort 0.1: fetch 方針設定＋ホップ検証ヘルパー＋テスト
- 根拠: 最小修正で新 capability を消す。将来の fetch 追加に対する規約化を含む

## BDD受け入れシナリオ

```gherkin
Scenario: リダイレクトは FETCH_URL で拒否される
  Given 許可された URL が 30x で private IP へリダイレクトする
  When FETCH_URL が fetch を実行する
  Then リダイレクトは失敗（error または manual+拒否）し、private 応答は返らない

Scenario: 正当な同一オリジン/https 昇格リダイレクトの扱いが明確である
  Given 許可 URL が同一ホストの https へリダイレクトする
  When FETCH_URL が fetch を実行する
  Then 設計した方針（許可またはホップ毎再検証の通過）に従い取得される

Scenario: ホップ毎検証ヘルパーは private IP を拒否する
  Given リダイレクト先が 127.0.0.1/10.x/192.168.x/169.254.x である
  When hop 再検証ヘルパーが評価する
  Then 拒否される

Scenario: 他の fetch サイトは現行どおり動作する（回帰防止）
  Given tranco/gist/obsidian/AI が固定ホストで fetch する
  When 通常の応答が返る
  Then 既存テストが全てグリーン（リダイレクト方針の変更は FETCH_URL 系のみ）
```

## 受け入れ基準
- [ ] `src/background/handlers/systemHandlers.ts:87` の FETCH_URL fetch に `redirect: 'error'`（または `manual`＋ホップ毎 `validateUrlForFilterImport` 再検証）が設定されている
- [ ] `src/utils/fetch.ts` に hop-level 再検証ヘルパー（`fetchWithRedirectGuard` 仮称）が新設され、`validateUrlForFilterImport`＋private IP ガードをホップ毎に適用する
- [ ] 正当なリダイレクトの扱い（拒否 or 許可）が ADR またはコメントで明文化されている
- [ ] 許可 URL → 30x → private IP（127.0.0.1:9222 等）へのリダイレクトが拒否されるテストを追加
- [ ] 既存 fetch 系テストが全てグリーン
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] VulnHunter 再検証: FETCH_URL のリダイレクト到達が不可能になる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし（fetch モックで検証）

### 統合テスト
- `FETCH_URL` handler × redirect モック: 30x で private IP に飛ぶ応答が拒否されること

### 単体テスト
- 新規: `src/utils/__tests__/fetchRedirectGuard.test.ts`
  - ビジネスロジック: ホップ毎検証の通過/拒否
  - 境界値: 同一オリジン https 昇格、ポート違い、相対 Location
  - 例外: リダイレクトループ、Location 欠落

## 実装アプローチ
- **Outside-In**: handler 統合テストを Red（redirect で private 応答が返る）→ `redirect: 'error'` で Green → ヘルパー化
- **Red-Green-Refactor**: まず最も単純な `redirect: 'error'` で塞ぎ、正当リダイレクトのニーズが確認できたら manual＋再検証へ拡張

## 見積もり
1pt（要チームでの見積もり — fetch 方針＋ヘルパー＋テスト）

## 技術的考慮事項
- 依存関係: なし（Wave 1 推奨）。PBI 03（body caps）と `systemHandlers.ts` を共有 → マージ順に注意
- テスタビリティ: `Response.redirected`/`Response.url` で検証可能
- 非機能要件: 他 16 fetch サイト（固定ホスト・検証済み）の挙動不変
- 注意: `manual` モード採用時は opaqueredirect 応答の扱いを確認すること
- 行番号は監査時点（2026-08-29）のもの。着手時に該当シンボルで再確認すること

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '80,110p' src/background/handlers/systemHandlers.ts
rg -n "redirect" src/utils/fetch.ts src/background/handlers/systemHandlers.ts
sed -n '180,205p' src/utils/ssrfGuard.ts
```

### 実装手順
1. FETCH_URL の fetch オプションに `redirect: 'error'` を設定
2. 正当リダイレクトの必要性確認（既存フィルタ供給元の実態）→ 必要なら manual＋`fetchWithRedirectGuard` へ
3. テスト追加、`npm run validate`

### 落とし穴
- `redirect: 'error'` は http→https 昇格さえ拒否する — フィルタ供給元の実URLを確認してから方針を固定すること
- `manual` の opaqueredirect は body/status が読めない — ホップ再検証は `Location` ヘッダから自前で追跡することになる
- Tranco/gist は固定ホストで FETCH_URL のガード対象外（スイープ済み）— 過剰適用しない

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-016 が解消されること
