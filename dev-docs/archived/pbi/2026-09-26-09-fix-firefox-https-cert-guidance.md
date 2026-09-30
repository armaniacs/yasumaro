# PBI: Firefox で HTTPS + 自己署名証明書の Obsidian 接続を案内できるようにする

種別: fix

対応 Issue: https://github.com/armaniacs/yasumaro/issues/160

## ユーザーストーリー

Firefox で Yasumaro を使っているユーザーとして、Obsidian Local REST API に HTTPS で接続したい。証明書が信頼されていない場合に「Obsidian が起動しているか確認してください」とだけ表示されるのは誤解で、実際には証明書の信頼を完了させる必要がある。その手順を案内してほしい。

## ビジネス価値

- Firefox ユーザーが HTTPS（推奨プロトコル）を使えず HTTP に fall back する、または使い方を諦めるケースを減らす。
- ネットワーク失敗と証明書失敗の切り分けを案内に出すことで、サポート（Issue 報告）のコストを下げる。
- 既存の証明書承認リンクが本番で一度も表示されない潜在バグを、構造化シグナル導入により構造的に除去する。

## 優先度

- 順位: 未採点（ユーザー報告バグ。Issue #160 起票）
- RICEスコア: —（個別 RICE 採点は未実施）

## 問題の事実（2026-09-26 実測）

1. **証明書承認リンクは本番で到達不能。**
   `src/dashboard/generalSettings/connectionTests.ts:162` の表示条件は
   `obsidianResult.message.includes('Failed to fetch')`。一方 SW 側の
   `ObsidianClient.testConnection` は fetch 失敗（`TypeError` / `Failed to fetch`）を
   `Cannot connect. Check if Obsidian is running and Local REST API is enabled.`
   に書き換えてから返す（`src/background/obsidianClient.ts:329-330`）。
   ダッシュボードが受け取るメッセージに `Failed to fetch` は存在しないため、
   リンクは本番で一度も表示されない。単体テストはモックが生メッセージを返すため
   green になる（`connectionTests.test.ts:441-487`）。
2. **リンク先ホストがハードコード。** `connectionTests.ts:165` は
   `https://127.0.0.1:${port}/` を生成し、設定中の host（`localhost` やリモート vault）
   を無視する。
3. **Firefox 固有の案内が存在しない。** Firefox の fetch 失敗は
   `TypeError: NetworkError when attempting to fetch resource` で Chrome と文言が違うが、
   name は同じ `TypeError`。メッセージ部分一致では判別できない。
   `chrome.runtime.getBrowserInfo` はコードベース全体で未使用。
4. **Firefox では OS の証明書登録だけでは不十分な場合がある。** Firefox は独自の
   証明書ストアを持ち、ユーザーが「CERT ファイルを登録した」（Issue #160 の報告）
   しても Firefox から信頼されていないケースがある。対処は
   (a) タブで `https://host:port/` を開いて証明書例外を追加する
   (b) Firefox の証明書マネージャー（設定 → プライバシーとセキュリティ → 証明書）
       に CA をインポートする
   の 2 経路。拡張からプログラム的に証明書を信頼させることはできないため、
   拡張側の正しいスコープは**案内の正確さ**である。
5. **HTTPS は実質必須。** 既定のプロトコルは https（`obsidianConfigValidator.ts:44-45`）で、
   非 loopback ホストへの HTTP はブロックされる（同ファイル 57-64 行目）。
   Firefox ユーザーに HTTPS が使えない状態は、安全な接続手段の喪失を意味する。
6. **利用経路は 2 系統。** `testObsidianConnection()` は dashboard 一般設定
   （`connectionTests.ts`）と診断パネル（`diagnosticsActions.ts:89`）から呼ばれる。
   修正はヘルパー層で行えば両方に効く。

## BDD受け入れシナリオ

```gherkin
Scenario: HTTPS 接続が証明書エラーで失敗したとき案内が出る
  Given プロトコルが https で証明書がまだ信頼されていない
  When 接続テストを実行してネットワーク層の失敗になる
  Then 設定中のホストとポートへの証明書承認リンクが表示される
  And リンクの URL には設定中のホストが使われる
  And 127.0.0.1 固定の URL は表示されない

Scenario: Firefox では Firefox 向けの手順が追加される
  Given 拡張が Firefox で動作している
  When https の接続テストがネットワーク層の失敗になる
  Then 証明書例外を追加する手順の案内が表示される
  And Firefox の証明書マネージャーへの CA 取り込み案内も表示される

Scenario: Chrome では汎用の案内が出る
  Given 拡張が Chrome で動作している
  When https の接続テストがネットワーク層の失敗になる
  Then 証明書承認リンクが表示される
  And Firefox 専用の手順は表示されない

Scenario: http では証明書の案内を出さない
  Given プロトコルが http である
  When 接続テストが失敗する
  Then 証明書の案内は表示されない

Scenario: タイムアウトでは証明書の案内を出さない
  Given https で接続がタイムアウトする
  When 接続テストを実行する
  Then 証明書の案内は表示されずタイムアウトの案内が出る
```

## 受け入れ基準

- [ ] `TEST_OBSIDIAN` のレスポンスに構造化 failure 情報（kind: `network` / `timeout` 等、
      `FailureMetadata` 互換）が載る。ダッシュボード側の表示条件がメッセージ文字列の
      部分一致に依存しなくなる。
- [ ] 証明書承認リンクが、SW 経由の実際のレスポンス（メッセージが書き換えられた状態）でも
      表示される。既存の到達不能条件を除去する。
- [ ] リンク先 URL が設定中の host:port を使う（フォーム入力値優先、空なら保存済み設定、
      さらに空なら `127.0.0.1`）。
- [ ] Firefox 検出時（`chrome.runtime.getBrowserInfo`）に Firefox 向け案内文を表示する。
      案内には (a) URL を開いて例外を追加する手順、(b) 証明書マネージャーへの CA
      インポート、の 2 経路を含む。
- [ ] Chrome（getBrowserInfo 非存在）では Firefox 専用文を出さず汎用案内に落ちる。
- [ ] http プロトコル、および failure kind が `network` 以外（timeout 等）のときは
      証明書案内を表示しない。
- [ ] 新規 i18n キーは ja/en 両 locale に定義し、parity を検証するテストを置く。
- [ ] 既存テスト（`connectionTests.test.ts` の証明書リンク群）を構造化シグナル起点に更新する。
- [ ] `docs/SETUP_GUIDE.md` に Firefox + 自己署名 HTTPS のトラブルシューティングを
      ja/en 両方追記する。
- [ ] `npm run type-check` と `npm run validate` が成功する。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 対象外。Firefox 拡張の E2E は自動化できない（`dev-docs/TESTING_GUIDE.md` 参照）。
  代わりに Firefox 手動スモーク手順を TESTING_GUIDE に追記する
  （証明書例外追加 → 接続テスト成功 → 記録動作まで）。

### 統合テスト

- MessageRouter → testingHandlers → `ObsidianClient.testConnection` の経路で、
  `TypeError` が kind `network`、`AbortError` が kind `timeout` として envelope に乗ること。
- `TEST_OBSIDIAN` レスポンス型の拡張（オプショナルフィールド追加）が
  既存 envelope 検証（`messaging/validators.ts`）を壊さないこと。

### 単体テスト

- `connectionTests.ts`: リンク表示条件（kind 起点へ変更）、ホスト反映、
  Firefox/Chrome 分岐、http と timeout で非表示。
- `obsidianClient.ts`: `testConnection` の catch 経路で failure metadata 付与。
  メッセージ文言自体は既存 SSOT 文言のまま維持する。
- i18n parity: 新規キーが ja/en で同一定義であること。

## 実装アプローチ

1. **SW 側（構造化シグナル）**: `ObsidianClient.testConnection` の戻り値
   `ObsidianConnectionResult` にオプショナルな `failure?: FailureMetadata` を追加。
   catch 経路で `resolveFailure()` / `createFailure()` を使って kind を付与
   （AbortError → timeout、TypeError → network）。メッセージ文言は変更しない。
   `withFailure()`（`failureTaxonomy.ts`）がそのまま使える。
2. **メッセージ型拡張**: `messaging/types.ts`・`src/background/messageTypes.ts` の
   TEST_OBSIDIAN レスポンスにオプショナルフィールドを追加し、validator も対応させる。
3. **ダッシュボード側**: `handleTestObsidian()` の表示条件を
   `obsidianResult.failure?.kind === 'network' && protocol === 'https'` に変更。
   リンク URL をフォームの hostInput 値（既に 73 行目で取得済み）から構築。
4. **Firefox 検出**: `typeof chrome.runtime.getBrowserInfo === 'function'` ガードで
   呼び出し、`name === 'Firefox'` のとき Firefox 向け i18n キーを使う。非同期のため
   接続テスト結果の描画前に解決しておく。
5. **i18n**: 新規キー（例: `certGuideFirefox`）を `public/_locales/{ja,en}/messages.json`
   に追加。既存 `acceptCertificate` は維持。
6. **ドキュメント**: SETUP_GUIDE.md の ja/en 両セクションに追記。

Outside-In で: 統合テスト（envelope に kind が乗る）→ 単体テスト（表示条件）→ 実装 →
リファクタリング（文言生成の共通化など）の順に進める。

## 見積もり

1.5 SP

## 技術的考慮事項

- **依存関係**: なし。PBI 2026-09-25-32（Obsidian 認証エラー文言）とは failure kind の
  種類が違う（auth vs network）ため競合しない。ただし両方とも
  `errorClassification.ts` / 表示経路に触れる場合、着手前に当該 PBI の状態を確認する。
- **テスタビリティ**: `getBrowserInfo` はインジェクト可能な形（オプション引数または
  モジュール関数）にして、Chrome/Firefox をテストから切り替えられるようにする。
- **セキュリティ**: リンク href は `https://` スキーマを固定して構築し、host から
  空白・制御文字を除去する（`validateObsidianHost` 相当のサニタイズ）。
  ユーザー入力をそのまま href に連結しない。
- **非互換リスク**: `ObsidianConnectionResult` へのフィールド追加はオプショナルなので
  既存呼び出し（recordingPipeline 等）に影響しない。レスポンス型の拡張も
  追加のみで行う。
- **ロールバック**: 表示文言・UI 条件の変更が主体で、revert で戻る。ストレージ
  スキーマ・manifest 権限の変更は含まない。

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）

```bash
# 証明書リンクの現状（到達不能条件とハードコード host）
grep -n "acceptCertificate\|Failed to fetch" src/dashboard/generalSettings/connectionTests.ts
# SW 側のメッセージ書き換え
grep -n "Failed to fetch" src/background/obsidianClient.ts
# 構造化 failure の既存契約
grep -n "withFailure\|FailureKind.NETWORK" src/utils/failureTaxonomy.ts
# getBrowserInfo が未使用であることの確認（0 件なら本 PBI が初導入）
grep -rn "getBrowserInfo" src/ entrypoints/
```

本 PBI は「証明書案内」自体は既存（壊れてはいるが）であり、
**修復 + Firefox 拡張**がスコープ。新規機能のゼロからの実装ではない。

### 実装手順

1. `src/utils/failureTaxonomy.ts` の `withFailure()` を読み、
   `ObsidianClient.testConnection` の catch 経路（`obsidianClient.ts:322-336`）で
   AbortError / TypeError から kind を組みて返す形にする。
2. `messaging/types.ts` の TEST_OBSIDIAN レスポンス型を拡張し、
   `messaging/validators.ts` のテストを更新する。
3. `connectionTests.ts` の `handleTestObsidian()` を書き換える:
   - 条件を kind 起点にする
   - リンク URL を hostInput 値から組み立てる
   - Firefox 向け案内文（新 i18n キー）を追加描画する
4. i18n キーを ja/en に追加し、parity テストを書く。
5. `connectionTests.test.ts` の既存証明書リンク群テスト（441-487 行付近）を
   構造化レスポンス起点に更新する。
6. SETUP_GUIDE.md と TESTING_GUIDE.md（Firefox 手動スモーク）を更新する。

### 落とし穴

- **メッセージ部分一致に戻らないこと。** 今回の根本原因は「SW が書き換えた後の
  メッセージを部分一致で判定していた」こと。Firefox の fetch エラー文言
  （`NetworkError when attempting to fetch resource`）は Chrome と異なり、
  文字列一致はブラウザ間で壊れる。`failureTaxonomy` の規律
  （「メッセージはシグナルにしない」）を守る。
- **`chrome.runtime.getBrowserInfo` は Chrome に存在しない。** `typeof` ガードなしで
  呼ぶと Chrome で例外になる。また Firefox でも Promise を返すので await が必要。
- **ホスト名の SAN 不一致。** CA を証明書マネージャーにインポートしても、
  証明書の SAN に接続先ホスト名が含まれていなければ失敗する。案内文では
  「例外を追加する」経路（(a)）を第一に示すのが確実。Obsidian Local REST API が
  生成する証明書の SAN 構成に依存した断定は書かない。
- **envelope 検証。** TEST_OBSIDIAN レスポンスにフィールドを足すと
  `senderTrustCoverage` / `envelopePolicy` 系の既存テストが型やスキーマで
  落ちる可能性がある。追加フィールドはオプショナルにし、validator の
  strict チェックに引っかからないか確認する。
- **診断パネルへの波及。** `diagnosticsActions.ts` も同じヘルパーを使うため、
  表示条件変更の影響を診断パネル側のテストでも確認する。

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする（Firefox 分岐は
      getBrowserInfo モックによる単体テストで担保）
- [ ] テストカバレッジが基準を満たす（新規分岐に対応する単体・統合テスト）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。変更は表示文言と
      messaging 型拡張を含むため、PR 説明に影響範囲を明記）
- [ ] リファクタリング完了（グリーン後、文言生成の重複があれば整理）
- [ ] ロールバック手段: revert で戻る（ストレージ・manifest 変更なし）ことを
      PR 説明に記載
- [ ] ドキュメント更新済み（SETUP_GUIDE.md ja/en、TESTING_GUIDE.md の Firefox
      手動スモーク手順）
- [ ] CHANGELOG.md にユーザー向け変更として記載
- [ ] **未実施（ユーザー作業）**: 実機 Firefox での証明書例外フロー確認
      （自己署名 HTTPS 環境が必要なため）
