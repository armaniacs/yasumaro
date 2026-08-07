# PBI: sqliteEngineContextのextractDomainを正規実装に統合する

**作成日**: 2026-08-07
**優先度**: 中
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟡軽微（SQLite保存時のドメイン値が変わる可能性。データ整合性検証要）
**種別**: 🔧非機能追加（refactor）

---

## 背景

コードレビューで `extractDomain` が2箇所に実装され、**挙動が乖離**していることが発見された。

### 重複の詳細

| ファイル | 行 | `www.`除去 | 失敗時戻り値 |
|---------|-----|-----------|--------------|
| `utils/domainUtils.ts:35-49` | カノニカル | あり（`www.`→除去） | `null` |
| `offscreen/sqliteEngineContext.ts:702-709` | 複製 | なし（`www.`保持） | 元の `url` |

### 乖離の影響

- 同じURLから抽出されるドメインが呼び出し元によって異なる（`www.` の有無）
- 失敗時の戻り値が `null` と `url` で異なり、呼び出し元の分岐に影響
- オフスクリーンエンジン側は正規実装を import せず独立複製している

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -rn "function extractDomain\|export function extractDomain" src/ --include="*.ts" | grep -v __tests__
grep -rn "extractDomain(" src/offscreen/ --include="*.ts" | grep -v __tests__
grep -rn "extractDomain(" src/utils/ --include="*.ts" | grep -v __tests__
```

## 受け入れ基準（BDD）

```gherkin
Scenario: extractDomainが単一の実装から提供される
  Given offscreen/sqliteEngineContext.ts に独立実装が存在する状態
  When ドメインを抽出する
  Then utils/domainUtils.ts の実装が使われる

Scenario: www.付きURLから正規化されたドメインが抽出される
  Given "https://www.example.com/page" のURL
  When extractDomain を呼ぶ
  Then "example.com" が返る

Scenario: 無効URLでは一貫した戻り値が返る
  Given パース不能なURL
  When extractDomain を呼ぶ
  Then 正規実装の仕様（null または呼び出し元に応じた扱い）で一貫する
```

## 受け入れ基準
- [ ] `offscreen/sqliteEngineContext.ts` のローカル `extractDomain` を削除
- [ ] `sqliteEngineContext.ts` から `utils/domainUtils.ts` の `extractDomain` を import（オフスクリーンが utils を import 可能か確認）
- [ ] `www.` 除去が必要ない呼び出し元は、正規化の後に別処理（またはオプション）で対応
- [ ] 既存の SQLite 保存・監査ログ関連テストがパスする
- [ ] 既存テストが全てパスする

## テスト戦略

### 単体テスト
- `domainUtils.extractDomain` の単体テスト（`www.`除去、無効URL、ポート付き）

### 回帰テスト
- `sqliteEngineContext`, `recordsRepo`, `auditLogRepo` 関連テストがパスすることを確認

## 実装アプローチ
- `sqliteEngineContext.ts` のローカル実装を削除し、`domainUtils.ts` から import
- `www.` の扱いが呼び出し元で必要な場合は、`domainUtils.ts` にオプション引数（`stripWww?: boolean`）を追加するか、正規化後の変換を呼び出し元で行う

## 見積もり
1pt（import 切り替え + 挙動統一 + テスト）

## 技術的考慮事項
- 依存: `src/utils/domainUtils.ts`, `src/offscreen/sqliteEngineContext.ts`
- オフスクリーンドキュメントから `utils/domainUtils.ts` を import 可能か確認。`domainUtils.ts` は `storage` に依存するため、オフスクリーン側への依存方向を検討（必要なら軽量な `extractDomain` を `utils/` の独立関数に切り出す）
- `www.` 除去の有無で SQLite 保存データが変わる可能性があるため、既存データとの整合性を確認

## 関連
- コードレビューレポート: 本セッションの重複レビュー（extractDomain 二重実装）
- 関連PBI: 2026-08-07-05-refactor-domain-matching-consolidation（domainUtils/urlSkipper/loader の統合。本PBIは sqliteEngineContext 側の独立複製を対象）
- 対象ファイル: `src/offscreen/sqliteEngineContext.ts`, `src/utils/domainUtils.ts`
