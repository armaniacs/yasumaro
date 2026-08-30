# PBI: クレンジングのドメイン別オーバーライドを可能にする

## ユーザーストーリー

ヘビーユーザーとして、サイトごとにクレンジング強度を変えたい。なぜなら技術ブログでは `deep` をONにしたいが、ECサイトでは商品情報が消えるためOFFにしたいなど、グローバルな32トグルでは最適化できないから。

## 優先度

- 順位: 07 / 15
- RICE: Reach 4 / Impact 3 / Confidence 0.6 / Effort 5日 = 1.44
- 根拠: ヘビーユーザー向け。需要はあるがReachは限定的。`domain_whitelist` / `domain_blacklist` との相互作用の設計が必要でEffortは高め。

## 背景

- 現行: `CleansingConfig` は `chrome.storage.local.get(['settings'])` でグローバルに1つ。`PageState.cleansingConfig` は全サイト共通。
- 課題: サイト特性に合わせた調整ができない。例えば `newsMedia` はニュースサイトでは有効だが、技術ブログでは不要。ユーザーは妥協的な中間設定を選ぶしかない。
- 機会: `storage/types.ts` に `CLEANSING_OVERRIDES: Record<domain, Partial<CleansingConfig>>` を追加し、`contentKernel.loadSettings()` でホスト名解決後にマージする。UIはポップアップに「このサイトではクレンジングを弱める/強める」トグル1つから始める。
- 類似: `DOMAIN_WHITELIST` / `DOMAIN_BLACKLIST` / `WHITELIST_EXTRACTION_ENABLED` は既にドメイン別制御を持つ。パターンを流用可能。

## BDD 受け入れシナリオ

```gherkin
Scenario: ドメイン別オーバーライドが適用される
  Given example.com で aiSummaryCleansingDeep=true のオーバーライドが保存されている
  And グローバル設定では deep=false である
  When example.com でページを抽出する
  Then deepEnabled=true でクレンジングが実行される

Scenario: 未登録ドメインはグローバル設定が使われる
  Given unknown.com にオーバーライドがない
  When unknown.com でページを抽出する
  Then グローバル設定のままクレンジングが実行される

Scenario: ポップアップでオーバーライドを設定できる
  Given example.com を閲覧している
  When ポップアップで「このサイトではクレンジングをOFF」を選択する
  Then example.com のオーバーライドが保存され、次回抽出から反映される

Scenario: オーバーライドを削除するとグローバルに戻る
  Given example.com のオーバーライドが存在する
  When オーバーライドを削除する
  Then example.com ではグローバル設定が使われる
```

## 受け入れ基準

- [ ] `storage/types.ts` に `CLEANSING_OVERRIDES` キーが追加される
- [ ] `contentKernel.loadSettings()` が `window.location.hostname` に基づきオーバーライドをマージする
- [ ] `PageState.cleansingConfig` はマージ後の値を持つ
- [ ] ポップアップまたはダッシュボードにドメイン別設定UIが追加される(最小: ON/OFF切替1つでも可)
- [ ] オーバーライドは `chrome.storage.local` に永続化され、`getSettings` / `saveSettings` で透過的に扱える
- [ ] `npm run validate` が通る

## テスト戦略

### E2E
- Playwrightで2ドメインを開き、それぞれ異なるオーバーライドでクレンジング結果が異なることを検証

### 統合
- `contentKernel.test.ts` にドメイン別マージの統合テスト。`FakeStoragePort` にオーバーライドを含めて `loadSettings` を検証
- `pageState.test.ts` にマージロジックのテスト

### 単体
- オーバーライド解決関数の単体テスト: 完全一致 / サブドメイン / 未登録 / 空オーバーライド
- ドメイン正規化テスト: `normalizeDomainUrl` との整合
- 境界: オーバーライドが空オブジェクト / 不正なキー / 32キー全て上書き

## 実装アプローチ

- **Outside-In**: オーバーライド解決の単体テストを先に書く → `storage/types.ts` にキー追加 → `contentKernel.loadSettings()` にマージロジック追加 → UI実装
- **段階移行**: 最初は `aiSummaryCleansingEnabled` のON/OFFのみをオーバーライド可能にし、成功したら32キー全てに拡大
- UIは最小から: ポップアップに「このサイトでクレンジングを無効化」チェックボックス1つ。ダッシュボードの詳細UIは次PBI

## 見積もり

5pt (解決ロジック1 + storage1 + contentKernel1 + UI2)

## 技術的考慮事項

- 依存: `domainFilterCache.ts` / `ChromeDomainPolicyPort` のドメイン正規化ロジックを流用
- テスタビリティ: `contentKernel` は `StoragePort` / `DomainPolicyPort` を注入可能。`FakeStoragePort` でテスト容易
- 非機能: `chrome.storage.local` の容量上限(5MB)。オーバーライドが100ドメイン×32キーで ~3KB。問題なし
- セキュリティ: ドメイン文字列のバリデーション。`isPrivateIpAddress` 等のSSRFガードと同様の検証を流用

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "domain_whitelist\|domain_blacklist\|WHITELIST_EXTRACTION" src/ --include="*.ts" | head -n 20
cat src/content/contentKernel.ts | grep -n "loadSettings"
cat src/utils/storage/types.ts | grep -n "DOMAIN_\|CLEANSING"
```

### 実装手順
1. `storage/types.ts` に `CLEANSING_OVERRIDES: 'cleansing_overrides'` を追加し `StorageKeyValues` に `Record<string, Partial<CleansingConfig>>` を定義
2. `storage/defaults.ts` にデフォルト `{}` を追加
3. `contentKernel.loadSettings()` で `s[StorageKeys.CLEANSING_OVERRIDES]` を読み、 `window.location.hostname` でマッチするオーバーライドを `Object.assign` でマージ
4. `entrypoints/popup/index.html` にドメイン別トグルを追加し、 `popup/main.ts` で保存/読込
5. テスト: `contentKernel.test.ts` にドメイン別マージのテストを追加

### 落とし穴
- `window.location.hostname` は Content Script でのみ取得可能。Service Worker 側でのマージは不可
- サブドメインの扱い: `sub.example.com` は `example.com` のオーバーライドを継承するか、完全一致のみか。仕様を明確にすること。`matchesWildcardPattern` の挙動と整合を取る
- `CleansingConfig` の `Record<ThresholdProp, number>` 交差部分はオーバーライド時に型安全にマージできるか検証が必要

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
