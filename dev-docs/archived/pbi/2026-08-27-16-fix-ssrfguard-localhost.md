# PBI: ssrfGuard localhostブロック無効

## ユーザーストーリー
内部ネットワークを保護したい管理者として、ssrfGuardのlocalhostブロックが確実に機能するようにしたい、なぜなら `127.0.0.1` / `localhost` が除外されているとSSRF攻撃で内部サービスへアクセスされるから。

## 優先度
- 順位: 4 / 17
- RICEスコア: 420（Reach=30 / Impact=2 / Confidence=70% / Effort=0.1）
- 根拠: SSRF経由の内部アクセスを試みる攻撃者に影響 (Reach=30)。内部サービス露呈で中影響 (Impact=2)。`src/utils/ssrfGuard.ts:11-17` の `BLOCKED_PATTERNS` が `127.0.0.1`/`localhost` を除外していることは確信70%（Obsidian API用途の意図的除外だがSSRF面で不備）。パターン修正または `isPrivateIpAddress` 呼び出しでEffort 0.1。

## なぜなぜ分析
- なぜlocalhostブロックが無効か: `src/utils/ssrfGuard.ts:11-17` の `BLOCKED_PATTERNS` が `127.0.0.1` と `localhost` をコメント「Obsidian APIで使用されるため除外」で除外し、実質的に `127.0.0.1` / `localhost` へのSSRFが素通りするため
- なぜ除外したか: Obsidian Local REST APIが `https://127.0.0.1:27124` で動作するため、汎用的な `validateUrl` でlocalhostをブロックすると正当なObsidian連携が破壊される懸念があった
- なぜ気づかなかったか: `validateUrlForFilterImport` / `validateUrlForAIRequests` では `isPrivateIpAddress` で別途ブロックしているが、`validateUrl(url, { blockLocalhost: true })` の汎用パスでは `BLOCKED_PATTERNS` のみに依存し、呼び出し元が `blockLocalhost: true` を期待しても効果が無い
- 解: `BLOCKED_PATTERNS` に `127.0.0.1`/`localhost` を追加、または `validateUrl` の `blockLocalhost` 分岐で `isPrivateIpAddress(parsedUrl.hostname)` を併用して判定

## ビジネス価値
SSRF攻撃による `127.0.0.1` / `localhost` への内部サービスアクセスを防止し、クラウドメタデータ (`169.254.169.254`) と同様に内部ネットワークの保護を完全化する。Obsidian連携の正当なlocalhost利用は `isLocalhostAddress` のポート制限付き許可で維持。

## BDD受け入れシナリオ

```gherkin
Scenario: ハッピーパス — Obsidian用の許可されたlocalhostポートは許可される
  Given URLが "https://127.0.0.1:27124/" である（Obsidian Local REST API）
  When validateUrlForAIRequests(url) を呼ぶ（isLocalhostAddressで許可）
  Then エラーはthrowされず、リクエストは許可される

Scenario: 攻撃 — blockLocalhost=trueで127.0.0.1はブロックされる
  Given URLが "http://127.0.0.1:8080/admin" である
  When validateUrl(url, { blockLocalhost: true }) を呼ぶ
  Then "Blocked hostname: 127.0.0.1" エラーがthrowされる
  And  localhost "http://localhost:3000/" でも同様にブロックされる
```

## 受け入れ基準
- [x] `src/utils/ssrfGuard.ts:11-17` の `BLOCKED_PATTERNS` が `127.0.0.1` / `localhost` を正しくブロックする（パターン修正）、または `validateUrl` の `blockLocalhost` 分岐で `isPrivateIpAddress(parsedUrl.hostname)` を呼び出して判定する
- [x] `validateUrl("http://127.0.0.1/", { blockLocalhost: true })` がthrowする
- [x] `validateUrl("http://localhost/", { blockLocalhost: true })` がthrowする
- [x] `validateUrl("http://127.0.0.1:27124/", { blockLocalhost: false })` はthrowしない（Obsidian用途のデフォルト許可を維持）
- [x] `validateUrlForFilterImport` / `validateUrlForAIRequests` の既存の `isPrivateIpAddress` / `isLocalhostAddress` による保護が回帰しない
- [x] `npm run type-check && npm test -- ssrfGuard` がパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 不要（SSRFガードは単体/統合でカバー）

### 統合テスト
- `validateUrlForFilterImport("http://127.0.0.1/")` がSSRFブロックすることを検証（既存テストの回帰確認）
- `validateUrlForAIRequests("http://127.0.0.1:27124/")` が許可され、`http://127.0.0.1:8080/` がブロックされることを検証

### 単体テスト
- `validateUrl` の `blockLocalhost: true` で `127.0.0.1`, `127.0.0.5`, `localhost`, `[::1]`, `::ffff:127.0.0.1` がブロックされる
- `blockLocalhost: false` では同じURLがブロックされない
- `BLOCKED_PATTERNS` の各パターンが期待通りにマッチすることを検証
- 境界値: `127.0.0.1` の各オクテット境界、`localhost` の大文字小文字、`LOCALHOST`

## 実装アプローチ
- **Outside-In**: 単体テスト（validateUrlのblockLocalhost分岐）→ 実装（パターン修正 or isPrivateIpAddress呼び出し）→ グリーン
- **Red-Green-Refactor**: まず `127.0.0.1` がブロックされないことを示す失敗テストを書き、次に修正でパスさせる
- **リファクタリング**: グリーン後に `BLOCKED_PATTERNS` と `isPrivateIpAddress` の責務重複を整理。コメントの「除外」理由を更新

## 見積もり
0.1pt（パターン1行修正または関数呼び出し1行追加、要チームでの見積もり）

## 技術的考慮事項
- 依存関係: `src/utils/ssrfGuard.ts` のみ。`isPrivateIpAddress` は同ファイル内で既に定義済み
- テスタビリティ: `validateUrl` は純粋関数で単体テスト容易。`chrome` API依存なし
- 非機能要件: セキュリティ（SSRF防止）。Obsidian連携との両立が最重要
- 影響範囲: `validateUrl` の `blockLocalhost` 分岐。`validateUrlForFilterImport` / `validateUrlForAIRequests` は既に `isPrivateIpAddress` で保護しているため影響小

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "BLOCKED_PATTERNS\|blockLocalhost\|isPrivateIpAddress" src/utils/ssrfGuard.ts
grep -rn "validateUrl" src/utils/__tests__/ssrfGuard.test.ts src/utils/__tests__/fetch.test.ts 2>/dev/null | head -20
```

既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。

### 実装手順
1. `src/utils/ssrfGuard.ts:11-53` を読む。現状 `BLOCKED_PATTERNS` が `127.0.0.1`/`localhost` を除外し、`validateUrl` の `blockLocalhost` 分岐が `BLOCKED_PATTERNS` のみに依存していることを確認
2. 修正案A（推奨）: `validateUrl` の `blockLocalhost` 分岐で `isPrivateIpAddress` を併用
   ```typescript
   if (blockLocalhost) {
     if (isPrivateIpAddress(parsedUrl.hostname)) {
       throw new Error(`Blocked hostname: ${parsedUrl.hostname}. Access to private network is not allowed.`);
     }
     if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname.endsWith('.localhost')) {
       throw new Error(`Blocked hostname: ${parsedUrl.hostname}. Access to localhost is not allowed.`);
     }
     for (const pattern of BLOCKED_PATTERNS) {
       if (pattern.test(parsedUrl.hostname)) {
         throw new Error(`Blocked hostname: ${parsedUrl.hostname}. Access to localhost addresses is not allowed.`);
       }
     }
   }
   ```
3. 修正案B（代替）: `BLOCKED_PATTERNS` に `127.0.0.1`/`localhost` パターンを追加
   ```typescript
   const BLOCKED_PATTERNS = [
     /^127\./,           // 127.0.0.1 等のループバック
     /^localhost$/i,     // localhost
     /^0x7f\./i,
     /^::1/,
     /^\[::f{0,4}:1\]$/i
   ];
   ```
   ただしObsidian用途で `blockLocalhost: false` がデフォルトのため、案Aの方が呼び出し元の意図を尊重できる
4. コメント `// 注: 127.0.0.1 は Obsidian API で使用されるため除外` を更新し、除外理由と新たな保護ロジックを明記
5. `src/utils/__tests__/ssrfGuard.test.ts` または `fetch.test.ts` に `blockLocalhost: true` での `127.0.0.1`/`localhost` ブロックテストを追加
6. `npm run type-check && npm test -- ssrfGuard` で検証

### 落とし穴
- `isPrivateIpAddress('localhost')` は `false` を返す（`fetch.test.ts:461` で確認）。`localhost` はIPではないため、IP判定だけではブロックできない。`hostname === 'localhost'` の明示的チェックが必須
- Obsidian Local REST APIは `127.0.0.1:27123` / `127.0.0.1:27124` で動作する。`blockLocalhost: false`（デフォルト）ではブロックしないことを維持し、`validateUrlForAIRequests` の `isLocalhostAddress` によるポート制限付き許可と整合させる
- `BLOCKED_PATTERNS` の正規表現が `127.0.0.1` の一部にマッチする際、`127.0.0.10` のような類似IPも正しくブロックされるか境界値テストで確認
- 既存の `validateUrlForFilterImport` は既に `isPrivateIpAddress` + `hostname === 'localhost'` でブロックしているため、二重ブロックにならないか確認（問題なし、同じエラーでthrowされるだけ）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [x] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [x] リファクタリング完了（グリーン後）
- [x] ロールバック手段の検討（1行修正のためrevertで即時切り戻し可能。Obsidian連携に影響が出た場合は `blockLocalhost` のデフォルト `false` で保護）
- [x] ドキュメント更新済み
