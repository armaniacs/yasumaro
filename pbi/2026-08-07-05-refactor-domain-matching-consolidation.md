# PBI: ドメインマッチング関数（extractDomain, matchesPattern, isDomainInList）を統合する

**作成日**: 2026-08-07
**優先度**: 中
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（内部実装変更。外部API・UIへの影響なし）
**種別**: 🔧非機能追加（refactor）

---

## 背景

コードレビューで、ドメインマッチング関数（`extractDomain`, `matchesPattern`, `isDomainInList`）が4ファイルに散在し、さらに `wildcardToRegex` パターンが7箇所で同一コードとして発見された。

### 重複1: ドメインマッチングトリオ

| ファイル | 関数 | ReDoSガード |
|---------|------|------------|
| `utils/domainUtils.ts` | `extractDomain`, `matchesPattern`, `isDomainInList` | あり（`MAX_WILDCARDS_PER_PATTERN = 5`） |
| `content/urlSkipper.ts` | `extractDomain`, `matchesPattern`, `isDomainInList` | なし |
| `content/loader.ts` | `extractDomain`, `matchesPattern`, `isDomainInList` | なし |
| `utils/storage/domainFilterCache.ts` | `normalizeDomainUrl`, `matchesWildcardPattern` | なし |

**リスク**: ReDoSガードが `domainUtils.ts` のみにあり、他3ファイルは脆弱。

### 重複2: `wildcardToRegex` パターン — 7箇所

```ts
pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')
```

| ファイル | 行 |
|---------|---|
| `dashboard/cspSettings.ts` | 313 |
| `utils/domainUtils.ts` | 71 |
| `popup/statusChecker.ts` | 103 |
| `utils/storage/domainFilterCache.ts` | 84 |
| `popup/pendingPages.ts` | 57 |
| `content/urlSkipper.ts` | 54 |
| `content/loader.ts` | 87 |

### 重複3: `SKIPPED_PROTOCOLS` + `shouldSkipUrl` — 2箇所

| ファイル |
|---------|
| `content/urlSkipper.ts` (7-26) |
| `content/loader.ts` (36-58) |

`loader.ts` のコメントに "urlSkipper.ts を参照" とあるが、実際には同一コードをコピーしている。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -rn "extractDomain\|matchesPattern\|isDomainInList" src/ --include="*.ts" | grep -v __tests__ | grep -v node_modules
grep -rn "pattern\.replace\[/" src/ --include="*.ts" | grep -v __tests__
grep -rn "SKIPPED_PROTOCOLS" src/ --include="*.ts" | grep -v __tests__
```

## 受け入れ基準（BDD）

```gherkin
Scenario: wildcardToRegexが単一の共通関数として利用される
  Given src/utils/wildcardToRegex.tsにエクスポートされた関数
  When 7箇所の呼び出し元がインポートする
  Then 全て同一の正規化が行われ、ReDoSガードが適用される

Scenario: extractDomain, matchesPattern, isDomainInListがdomainUtilsから利用される
  Given src/utils/domainUtils.tsにエクスポートされた関数
  When urlSkipper.tsがインポートする
  Then 同一のドメイン抽出・マッチングが行われる

Scenario: loader.tsがurlSkipper.tsからインポートする
  Given content/loader.ts
  When shouldSkipUrl, extractDomain, matchesPattern, isDomainInListを必要とする
  Then urlSkipper.tsからインポートできる（Content Scriptバンドルが許す場合）
```

## 受け入れ基準
- [ ] `src/utils/wildcardToRegex.ts` に `wildcardToRegex(pattern: string): RegExp | null` を作成し、ReDoSガードを含める
- [ ] `domainUtils.ts` の `matchesPattern()` を `wildcardToRegex()` を使うように書き換え
- [ ] `content/urlSkipper.ts` の `extractDomain`, `matchesPattern`, `isDomainInList` を `domainUtils.ts` からインポートに切り替え（Content Scriptバンドルが許す場合）
- [ ] `content/loader.ts` の同一関数群を `urlSkipper.ts` からインポートに切り替え（または `domainUtils.ts` から）
- [ ] 残り4箇所（`cspSettings.ts`, `statusChecker.ts`, `domainFilterCache.ts`, `pendingPages.ts`）の `wildcardToRegex` インラインコピーを共通関数に置換
- [ ] 既存テストが全てパスする

## テスト戦略

### 単体テスト
- `wildcardToRegex.ts` の単体テスト（通常パターン、ReDoS防止、エッジケース）
- `domainUtils.ts` の `matchesPattern` がReDoSガード付きであることを確認

### 回帰テスト
- 既存のドメインフィルタ関連テストがパスすることを確認

## 実装アプローチ
- まず `wildcardToRegex` を作成 → 次に `domainUtils.ts` を書き換え → 最後に呼び出し元を切り替え
- Content Script（`loader.ts`, `urlSkipper.ts`）のインポート可能性は、バンドル設定（WXT）を確認してから判断

## 見積もり
1pt（共通関数作成 + 7ファイルのインポート切り替え + テスト追加）

## 技術的考慮事項
- Content ScriptはESMモジュールサポートがない可能性がある。`loader.ts` のコメントに "Content Script エントリポイントのため静的 import/export 不可" とある
- `urlSkipper.ts` は既にContent Script用に分離済み。`loader.ts` は `urlSkipper.ts` からインポートできるか、バンドル設定を確認
- `domainFilterCache.ts` の `normalizeDomainUrl` / `matchesWildcardPattern` は `domainUtils.ts` の関数と重複しているが、ストレージモジュール内のため、インポート方向を検討

## 関連
- コードレビューレポート: 本セッションの重複レビュー（Cluster 9, 17）
- 対象ファイル: `src/utils/domainUtils.ts`, `src/content/urlSkipper.ts`, `src/content/loader.ts`, `src/utils/storage/domainFilterCache.ts`, `src/dashboard/cspSettings.ts`, `src/popup/statusChecker.ts`, `src/popup/pendingPages.ts`
