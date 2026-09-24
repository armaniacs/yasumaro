# PBI: SSRF ガードの残存リスクの脅威モデル明文化

種別: doc

## ユーザーストーリー

セキュリティレビューを行う担当者として、URLガードが検査する範囲と、DNS解決結果および実際の接続先IPの一致を検証しない残存リスクを Security Review Guide で確認したい。既存の緩和策を把握した上で、DNSリバインディングが残ることを前提に脅威モデルとして受容し、判断の根拠を追跡できるようにしたい。

## ビジネス価値

- URL validation だけでは SSRF を完全に防げないことをレビューで誤解することを防ぐ。
- 既存の検査範囲、到達範囲を限定する緩和策、残存する DNS リバインディングの関係を追跡可能にする。
- セキュリティレビュー担当者の受容判断の根拠と、MV3 で完全対策が難しいという制約を同じ文書に記録する。

## 優先度

- 順位: 21 / 30
- RICEスコア: 0.8（Reach=1 / Impact=0.5 / Confidence=80% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: URLガードの検査範囲を確認する
  Given Security Review Guide は URL validation を列挙している
  When セキュリティレビュー担当者が SSRF の脅威モデルを確認する
  Then URL構文、scheme、IPリテラル、localhost、private/link-local/ULA、redirect先の検査が記載されている
  And DNS解決結果と実際の接続先IPの一致を検証しないことが記載されている

Scenario: DNSリバインディングの残存リスクを追跡する
  Given public hostname は既存の validator で許可される
  When ブラウザの fetch 時にその hostname の DNS応答が private または loopback へ変わる可能性を考える
  Then Security Review Guide がその状態を DNSリバインディングの残存リスクとして明示する
  And URL validation だけでリスクが解消されたとは記載していない

Scenario: 4つの入口と緩和要因を確認する
  Given SSRFガードを使う主要な入口がある
  When セキュリティレビュー担当者が到達範囲を確認する
  Then filterインポートのURL取得、共通fetch、AI provider、手動/再生成タブのfetchが対象として示される
  And CSP、origin許可と確認、拡張機能内のみ、手動redirect、localhost port制約が到達範囲を限定する要因として示される
  And MV3 Service Workerには利用制御可能なDNSリゾルバや接続先pinning APIがない制約が示される
```

## 受け入れ基準

- [ ] `dev-docs/SECURITY_REVIEW_GUIDE.md` に、SSRFガードの検査範囲と未検証の範囲を記載する。
- [ ] `src/utils/ssrfGuard.ts:183-202` の filter import validator と、`:242-260` の AI request validator の位置と役割を記載する。
- [ ] `src/utils/fetch.ts:169-228` は redirect 先を URL 文字列として再検証するが、実際の接続先 IP は再検査しないことを記載する。
- [ ] URL ガードが検査する URL 構文、scheme、IP リテラル、localhost、private/link-local/ULA、redirect 先を、既存仕様として記載する。
- [ ] 主要な入口が、filter インポートの URL 取得、共通 fetch、AI provider、手動/再生成タブの fetch の4系統であることを記載する。
- [ ] `src/utils/__tests__/ssrfGuard.test.ts:17-135` の契約テストが23ケースであること、private IPv4/IPv6、localhost、scheme、redirect hop がテスト済みであることを記載する。
- [ ] public hostname をそのまま許可するテスト（`:113-115`、`:131-133`）があり、DNS が private または loopback に変わるケースのテストはないことを記載する。
- [ ] hostname の DNS 応答がブラウザの fetch 時に再選択され得るため、DNSリバインディングの残存リスクがゼロではないことを記載する。
- [ ] MV3 Service Worker には利用制御可能な DNS リゾルバや接続先 pinning API がないため、Service Worker 内で hostname と接続先 IP を一致検証できない制約を記載する。
- [ ] CSP、origin 許可と確認、拡張機能内のみ、手動 redirect、localhost port 制約を、到達範囲を限定する既存の緩和策として記載する。
- [ ] ドキュメントは「private IP リテラルと redirect を拒否する」以上の保証を記載せず、URL ガードだけで SSRF を完全に防げると表現しない。
- [ ] DNS 解決結果と接続先 IP の pinning 設計を、この文書だけで実装済みと扱わない。
- [ ] セキュリティレビュー担当者を残存リスクの受容者として明示し、判断の根拠を追跡できるようにする。
- [ ] 実コード、テストファイル、`public/PRIVACY.md`、`docs/PRIVACY.md` は変更しない。
- [ ] ドキュメントは現行仕様のスナップショットとして書き、issue 番号や変更履歴を残さない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- セキュリティレビュー担当者が Security Review Guide を開き、URLガードの検査範囲、DNSリバインディングの残存リスク、MV3 の制約、緩和要因、受容者を一続きに確認できることを確認する。
- ガイドだけを読み、URL validation があれば SSRF が完全に防がれると誤認しないことを確認する。
- private IP リテラルと redirect の拒否を超える保証や、接続先 IP の pinning のような保証が記載されていないことを確認する。

### 統合テスト

- Security Review Guide の記載を `src/utils/ssrfGuard.ts:183-202`、`:242-260`、`src/utils/fetch.ts:169-228` と照合する。
- ガイドに記載する4つの入口と、`src/utils/__tests__/ssrfGuard.test.ts:17-135` の23ケース、既存テストで DNS リバインディングを固定していない事実を照合する。
- ガイドの「現状の検査」「既存の緩和策」「残存リスク」を、MV3 Service Worker の DNS resolver・接続先 pinning API の制約と合わせて確認する。
- 文書変更が `public/PRIVACY.md` と `docs/PRIVACY.md` に波及していないことを確認する。

### 単体テスト

- 実コードを変更しないため、新しい単体テストは作成しない。
- 文書レビューで、URL 構文、scheme、IP リテラル、localhost、private/link-local/ULA、redirect 先、DNS 解決結果、接続先 IP、MV3 の制約が相互矛盾せず記載されていることを確認する。
- 既存の23契約テストの記載が、テスト数と公開 hostname の許可例および DNS 変更ケース未テストという事実と一致することを確認する。

## 実装アプローチ

1. 現状の Security Review Guide の URL validation 記載と、`ssrfGuard.ts`、`fetch.ts`、契約テストの事実を対応付ける。
2. ガイドの Threat Model Overview または Security Controls に、SSRFガードの検査範囲と「DNS解決結果・実際の接続先IPの一致を検証しない」という残存リスクを追加する。
3. private IP リテラル、localhost、private/link-local/ULA、redirect 先の拒否を記載したうえで、public hostname の DNS 応答が変わる場合を扱わない境界を明記する。
4. 4つの入口、CSP、origin 許可と確認、拡張機能内のみ、手動 redirect、localhost port 制約を、既存の緩和要因として記載する。
5. MV3 Service Worker には利用制御可能な DNS リゾルバや接続先 pinning API がないため、完全な接続先 IP pinning をこのガードの保証として記載しない。
6. セキュリティレビュー担当者を残存リスクの受容者として明記し、現行の URL ガードと残存リスクを同じ脅威モデルとして追跡できるようにする。
7. ガイド以外の実コード、テスト、プライバシー文書を変更せず、記載の安全性が弱まっていないことを文書レビューする。
8. 接続先 IP pinning の設計を求める場合は、本 PBI の範囲に含めず `investigate` に格上げする。

## 見積もり

0.5 SP

## 技術的考慮事項

- 依存関係: なし。
- `src/utils/ssrfGuard.ts:183-202` は filter import の validator、`src/utils/ssrfGuard.ts:242-260` は AI request の validator である。
- `src/utils/fetch.ts:169-228` は redirect 先を URL 文字列として再検証するが、接続先 IP を再検査する処理ではない。
- URLガードは private IP リテラルと redirect を拒否するが、hostname 文字列と DNS 解決結果、実際の接続先 IP の同一性は検証しない。
- public hostname を許可する既存契約テストがあるため、hostname の許可だけで DNS 応答の安全性を証明するわけではない。
- MV3 Service Worker には利用制御可能な DNS リゾルバや接続先 pinning API がない。
- CSP、origin 許可と確認、拡張機能内のみ、手動 redirect、localhost port 制約は到達範囲を限定する緩和策として扱う。
- この PBI は `dev-docs/SECURITY_REVIEW_GUIDE.md` に現行仕様スナップショットを追加するものであり、SSRFガードの実装を変更しない。
- 本 PBI では接続先 IP pinning の要件を設計せず、要件がさらに拡大する場合は別 PBI とする。

## 実装者向け注記

### 現状コードの確認

- `src/utils/ssrfGuard.ts:183-202` に filter import 用 validator があり、`:242-260` に AI request 用 validator がある。
- `src/utils/fetch.ts:169-228` は redirect の各 hop に対して URL を再検証するが、実際の接続先 IP を検査しない。
- 主要な入口は filter インポートの URL 取得、共通 fetch、AI provider、手動/再生成タブの fetchの4系統である。
- `src/utils/__tests__/ssrfGuard.test.ts:17-135` には23の契約テストがあり、private IPv4/IPv6、localhost、scheme、redirect hop をテストしている。
- `src/utils/__tests__/ssrfGuard.test.ts:113-115` と `:131-133` は public hostname をそのまま許可するテストである。
- DNS が private または loopback に変わるケースの契約テストはない。
- `dev-docs/SECURITY_REVIEW_GUIDE.md:22-53` は URL validation を列挙するが、DNSリバインディングの残存リスクを明記していない。

### 実装手順

1. `dev-docs/SECURITY_REVIEW_GUIDE.md` の既存の Threat Model Overview と Security Controls の構成を確認する。
2. URLガードが検査する URL 構文、scheme、IP リテラル、localhost、private/link-local/ULA、redirect 先を記載する。
3. DNS解決結果と実際の接続先IPの一致を検証しないこと、hostname の DNS 応答が fetch 時に再選択され得ることを記載する。
4. 4つの入口、CSP、origin 許可と確認、拡張機能内のみ、手動 redirect、localhost port 制約を記載する。
5. MV3 Service Worker の DNS resolver・接続先 pinning API の制約と、残存リスクの受容者を記載する。
6. ガイド外のコード、テスト、`public/PRIVACY.md`、`docs/PRIVACY.md` を変更しない。
7. 既存の URL ガードの説明と追加した残存リスクの説明が矛盾しないことをレビューする。

### 落とし穴

- ガイドの記述を弱くすると、URLガードがあるだけで SSRF が完全に防がれると誤認させる文言になる。
- private IP リテラルと redirect を拒否するという事実を、DNSリバインディングの防止や接続先 IP の保証に広げる文言にしない。
- public hostname を許可する契約テストを、DNS 応答が安全であることの証拠として書かない。
- URL文字列の再検証を、redirect 先の実際の接続先 IP の再検査として説明しない。
- MV3 Service Worker に利用制御可能な DNS resolver や接続先 pinning API があると書かない。
- `public/PRIVACY.md` と `docs/PRIVACY.md` を同期目的だけで変更しない。
- 接続先 IP pinning の設計まで本 PBI で求められた場合は、`investigate` に格上げする。

## 決定事項

### 5 Whys

1. なぜ rebinding が残るか。hostname 文字列と接続時 DNS 結果を一致検証できないためである。
2. なぜ MV3 内で完全対策が難しいか。Service Worker から利用制御可能な DNS resolver や pinning API がないためである。
3. なぜ即時の高リスクではないと判断できるか。CSP、origin 許可と確認、拡張機能内のみ、手動 redirect、localhost port 制約が到達範囲を限定するためである。
4. それでもリスクがゼロでないのは、hostname の DNS 応答がブラウザ fetch 時に再選択され得るためである。
5. 誰が残存リスクの受容者を明示するか。`dev-docs/SECURITY_REVIEW_GUIDE.md` に、セキュリティレビュー担当者、既存の緩和策、残存リスク、MV3 の制約、判断の根拠を記載する。

### 最終決定

- `dev-docs/SECURITY_REVIEW_GUIDE.md` を、SSRFガードの検査範囲と DNSリバインディングの残存リスクを記載する脅威モデルの正本とする。
- private IP リテラルと redirect の拒否は現行の緩和策として記載するが、DNS解決結果と接続先IPの一致を検証しない範囲を併記する。
- セキュリティレビュー担当者を残存リスクの受容者として明示する。
- MV3 Service Worker 内で利用制御可能な DNS resolver や接続先 pinning API が存在しないため、接続先 pinning の実装を本 PBI の受け入れ基準に含めない。
- 接続先 IP pinning の設計が新たに要求された場合は、本 PBI を `investigate` に格上げする。
- 実コード、テスト、プライバシー文書は変更しない。

## Definition of Done

- [ ] `dev-docs/SECURITY_REVIEW_GUIDE.md` に SSRFガードの検査範囲が記載されている。
- [ ] `dev-docs/SECURITY_REVIEW_GUIDE.md` に DNS解決結果と実際の接続先IPの一致を検証しないことが記載されている。
- [ ] DNSリバインディングの残存リスクと、MV3 Service Worker の制約が記載されている。
- [ ] 4つの入口、CSP、origin 許可と確認、拡張機能内のみ、手動 redirect、localhost port制約が、既存の緩和要因として記載されている。
- [ ] 契約テスト23ケース、public hostname の許可例、DNS変更ケース未テストという現状が記載されている。
- [ ] セキュリティレビュー担当者が残存リスクの受容判断を追跡できる。
- [ ] URLガードの実装、接続先 IP pinning、テストファイルを変更していない。
- [ ] `public/PRIVACY.md` と `docs/PRIVACY.md` を変更していない。
- [ ] ドキュメントは現行仕様のスナップショットのみで、issue 番号や変更履歴を含まない。
- [ ] ガイドの説明が private IP リテラルと redirect の拒否を超える保証を意味していないことをレビューで確認した。
