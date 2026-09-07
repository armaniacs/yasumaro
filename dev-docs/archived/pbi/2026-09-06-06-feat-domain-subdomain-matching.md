# PBI: ドメインフィルタのサブドメイン自動マッチング

## ユーザーストーリー
ドメインフィルタユーザーとして、「example.com」を入力するだけで「sub.example.com」や「www.example.com」にも自動的にマッチさせたい。なぜなら、`*.example.com`をわざわざ追加する手間を省き、設定の煩雑さを軽減したいから。

## ビジネス価値
- ドメインフィルタ設定時の入力手間を軽減
- `*.example.com` のようなワイルドカードパターンの理解・入力コストを撤廃
- ユーザーの設定ミス（サブドメインの漏れ）を防止

## BDD受け入れシナリオ

```gherkin
Scenario: サブドメインマッチングONでexample.comがサブドメインにマッチする
  Given ユーザーがドメインフィルタ設定を開いている
  And   ブラックリストに「example.com」が登録済み
  And   「サブドメインもマッチさせる」トグルがON
  When  「sub.example.com」にアクセスする
  Then  ドメインフィルタが「example.com」にマッチし、記録がブロックされる

Scenario: サブドメインマッチングOFFでexample.comがサブドメインにマッチしない
  Given ユーザーがドメインフィルタ設定を開いている
  And   ブラックリストに「example.com」が登録済み
  And   「サブドメインもマッチさせる」トグルがOFF
  When  「sub.example.com」にアクセスする
  Then  ドメインフィルタが「example.com」にマッチせず、記録される

Scenario: サブドメインマッチングONでwww.example.comがマッチする
  Given ユーザーがドメインフィルタ設定を開いている
  And   ホワイトリストに「example.com」が登録済み
  And   「サブドメインもマッチさせる」トグルがON
  When  「www.example.com」にアクセスする
  Then  ドメインフィルタが「example.com」にマッチし、記録が許可される

Scenario: トグルを切り替えた後、設定が保存される
  Given ユーザーがドメインフィルタ設定を開いている
  And   「サブドメインもマッチさせる」トグルがOFF
  When  トグルをONに切り替える
  And   「保存」ボタンをクリックする
  Then  設定が保存され、次回以降サブドメインマッチングが有効になる
```

## 受け入れ基準
- [x] ドメインフィルタ設定に「サブドメインもマッチさせる」トグルスイッチが表示される
- [x] トグルON時: `example.com` が `sub.example.com` / `www.example.com` にマッチする
- [x] トグルOFF時（デフォルト）: 従来通りの完全一致のみマッチ
- [x] トグルの状態が `chrome.storage.local` に保存される
- [x] 既存ユーザーはデフォルトOFFで、動作変更なし（後方互換性維持）
- [x] i18n対応（en/ja）
- [x] 既存テストがパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト（主体）
**`matchesDomainPattern()` のユニットテスト（サブドメインマッチング拡張）:**
- トグルOFF + 完全一致 → マッチ
- トグルOFF + サブドメイン → マッチしない
- トグルON + 完全一致 → マッチ
- トグルON + サブドメイン → マッチ
- トグルON + wwwサブドメイン → マッチ
- パターンが空 → マッチしない

**`evaluateCachedAllow()` のユニットテスト（トグル対応）:**
- トグルON + ホワイトリストモード + サブドメイン → 許可
- トグルON + ブラックリストモード + サブドメイン → 拒否

### 統合テスト（最小限）
- `DomainFilter.isAllowed()` の統合テスト（トグルON/OFF）
- キャッシュ更新時のトグル状態反映テスト

## 実装アプローチ
- **Outside-In**: 受け入れシナリオから開始し、`matchesDomainPattern()` のサブドメインロジックを拡張
- **Red-Green-Refactor**: TDDサイクルで各レイヤーを適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
3pt（UI追加 + マッチングロジック拡張 + キャッシュ更新 + テスト）

## 技術的考慮事項
- **依存関係**: `wildcardToRegex.ts`（`matchesDomainPattern`）、`DomainFilter.ts`（`evaluateCachedAllow`）、`storage/types.ts`（`StorageKeys`）
- **テスタビリティ**: トグル状態を引数として注入可能にし、テスト容易性を確保
- **非機能要件**: パフォーマンスへの影響なし（マッチングロジックは既に最適化済み）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# 機能に関連するキーワードでコードを探す
grep -rn "matchesDomainPattern\|isDomainInList" src/
grep -rn "DOMAIN_FILTER_MODE\|domain_filter_mode" src/
grep -rn "domainFilterToggle\|サブドメイン" src/
```

### 実装手順
1. `src/utils/storage/types.ts` に新しい `StorageKeys.DOMAIN_SUBDOMAIN_MATCHING` を追加
2. `src/utils/wildcardToRegex.ts` の `matchesDomainPattern()` を拡張し、サブドメインマッチングロジックを追加
3. `src/utils/domainFilter/DomainFilter.ts` の `evaluateCachedAllow()` を拡張し、トグル状態を反映
4. `src/dashboard/settings/domainFilter.ts` にトグルスイッチのUIを追加
5. `src/dashboard/domainFilterTagUI.ts` にトグルの初期化・保存ロジックを追加
6. i18nメッセージ（en/ja）を追加
7. 既存テストの更新 + 新規ユニットテスト追加

### 落とし穴
- `matchesDomainPattern()` の既存呼び出し元が多いた、変更の影響範囲を広く確認する
- キャッシュ更新ロジック（`updateDomainFilterCache`）にトグル状態を反映させる必要がある
- トグルON時でも `*.example.com` パターンは引き続き動作することを確認する（ワイルドカードとサブドメインマッチングの両立）

## Definition of Done
- [x] `matchesDomainPattern` のユニットテスト全パス
- [x] `evaluateCachedAllow` のユニットテスト全パス
- [x] `DomainFilter.isAllowed()` 統合テスト全パス
- [x] 既存テストがパスする
- [x] i18n対応（en/ja）
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）

## 実装メモ（2026-09-06 自律実装）
- `matchesDomainPattern(domain, pattern, matchSubdomains = false)` / `isDomainInList(..., matchSubdomains = false)` を拡張（デフォルト false で既存の全呼び出し元は無影響。ワイルドカードパターンはトグルの影響を受けない）
- ライブパス: `domainUtils.isDomainAllowed` が `DOMAIN_SUBDOMAIN_MATCHING` を読み、共有実装 `isDomainInListShared` に直接渡すよう変更。**ローカル 2引数ラッパー（`isDomainInList`）経由だと第3引数が握り潰される**問題を実装中に発見し、テスト（サブドメインON許可）で検出・修正済み
- キャッシュパス: `evaluateCachedAllow` / `DomainFilter.isAllowedCached` / `DomainFilterCacheAdapter` に matchSubdomains を伝播。`getDomainFilterCacheSync` がトグル値を返すように拡張（`storage.test.ts` の期待値を更新）
- UI: `#domainSubdomainToggle` をパネルに追加。load/save は `settings/domainFilter.ts`（`loadDomainSettings` / `handleSaveDomainSettings`）で処理。タグUIの保存は hidden ボタン経由で `handleSaveDomainSettings` に委譲されるため `domainFilterTagUI.ts` の変更は不要（PBI実装手順5との差分 — 委譲構造を尊重）
- i18n: `domainSubdomainMatching`（en/ja）。デフォルトOFFで後方互換
- テスト: wildcardToRegex 9 cases / domainFilter-seam 6 assertions / domainUtils isDomainAllowed 3 cases を追加
- コードレビューは diff 自レビュー＋全体検証で実施
