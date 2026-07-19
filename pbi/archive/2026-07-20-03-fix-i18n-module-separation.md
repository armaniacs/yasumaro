# PBI: i18n モジュールの副作用除去とDOM関数分離

元指摘: Checking Team (Medium: System Architect, Legacy Bridge Architect; Low: Refactoring Evangelist)

## ユーザーストーリー
開発チームとして、`src/utils/i18n.ts` のモジュールレベル副作用（`DOMContentLoaded` リスナー登録と即時実行）を除去し、DOM依存関数を別ファイルに分離したい、なぜなら現在 Service Worker や Offscreen Document など `document` が存在しないコンテキストでこのモジュールを import すると ReferenceError でクラッシュする潜在リスクがあり、また `getMessage` の `substitutions` 型が狭まったことで一部の呼び出し元でコンパイルエラーが発生しているから

## ビジネス価値
- Service Worker / Offscreen Document からの安全な i18n モジュール利用を可能に
- 型安全性の向上（substitutions の型制約）
- モジュール初期化の明示化による予測可能性向上

## BDD受け入れシナリオ

```gherkin
Feature: i18n モジュール分離

  Scenario: Service Worker から i18n モジュールを安全に import できる
    Given document が存在しないコンテキスト（SW など）で
    When src/utils/i18n.ts を import する
    Then ReferenceError が発生しない
    And getMessage() が正常に呼び出せる

  Scenario: DOM依存関数（applyI18n 等）が非UIコンテキストで利用できない
    Given document が存在しないコンテキストで
    When src/utils/i18n-dom.ts を import しようとする
    Then 明示的なエラーが発生する（または import 時にガードされる）

  Scenario: getMessage の substitutions が適切な型で受け渡せる
    Given 従来 any 経由で substitutions を渡していたコードがある
    When getMessage を呼び出す
    Then 型エラーにならない
    And ランタイムの挙動が変わらない
```

## 受け入れ基準
- [ ] `src/utils/i18n.ts` から DOM 依存関数（`applyI18n`, `setHtmlLangAndDir`, `translatePageTitle`）を `src/utils/i18n-dom.ts` に分離
- [ ] `src/utils/i18n.ts` は `getMessage`, `getUserLocale`, `isRTL` のみの pure モジュールとする
- [ ] モジュールスコープの即時実行（`DOMContentLoaded` リスナー登録）を削除し、各UIエントリポイントで明示的に `applyI18n()` を呼び出す設計に変更
- [ ] `getMessage` の `substitutions` 型にオーバーロードを追加し、従来の any 経由の呼び出しを許容
- [ ] 既存の全 import パスを更新（i18n.ts から DOM 関数を import している箇所は i18n-dom.ts に変更）
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 統合テスト
- popup・dashboard 両方で翻訳表示が変更前と同じであることを確認（既存テストを移行）

### 単体テスト
- `getMessage`（オーバーロード含む）の型テスト
- `applyI18n` / `setHtmlLangAndDir` / `translatePageTitle` の DOM 操作テスト

## 実装アプローチ
- **Safe Refactor**: まず `i18n-dom.ts` を作成し DOM 関数を移動。既存の import 元をすべて更新。次に `i18n.ts` の副作用を除去。最後に `getMessage` オーバーロードを追加。
- 既存テストの参照パスを新しいファイルに変更するのみで、テストロジック自体の変更は最小限。

## 見積もり
3pt（ファイル分割 + import パス更新 + 副作用除去 + テスト移行）

## 技術的考慮事項
- 既存の import 元を洗い出す: `grep -rn "from.*i18n.js\|from.*i18n'" src/ entrypoints/ --include="*.ts"`
- `setHtmlLangAndDir` は `entrypoints/popup/i18n.ts`（旧）にも存在するが、既に `src/utils/i18n.ts` に統合済み。`i18n-dom.ts` への再移行が必要
- **依存関係: PBI-05 (UI/CSS修正)** は Permissions ページで `setHtmlLangAndDir()` を呼ぶため、このPBI（i18n モジュール分離）の完了後に実装すること。DOM関数の移動先パスに依存するため

## 落とし穴
- `src/popup/navigation.ts` が `setHtmlLangAndDir` を `src/utils/i18n.js` から import している。`i18n-dom.ts` への変更漏れに注意
- モジュールスコープの即時実行を削除すると、これに依存していたコード（自動翻訳適用）が動作しなくなる。各エントリポイントで明示的な初期化呼び出しを追加すること

## Definition of Done
- [ ] `i18n-dom.ts` が作成され DOM 関数が移動している
- [ ] `i18n.ts` から副作用が除去されている
- [ ] 全 import パスが更新されている
- [ ] `getMessage` オーバーロードが追加されている
- [ ] テストが更新されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
