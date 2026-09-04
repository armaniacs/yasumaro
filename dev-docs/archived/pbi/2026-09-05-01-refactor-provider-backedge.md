# PBI 01: プロバイダー許可チェックの back-edge を低層の中立テーブルに反転

優先度: 1 位 / RICE 32.0 = (10 × 2 × 80%) / 0.5w / Strength: Strong（2 方向の探索が独立に Strong 判定で収束）
backlog: [2026-09-05-00-backlog-arch4.md](2026-09-05-00-backlog-arch4.md)
依存: なし（他 6 件と独立。PBI 02 の dynamic-import 回避を本 PBI で除去するため ProviderStrategy.ts に触れるが、他 PBI と重ならない）

## ユーザーストーリー
AI 通信基盤を保守する開発者として、プロバイダー許可チェック（base URL 許可・allowlist 構築）が低層の中立テーブルに集約されてほしい。なぜなら現状は `src/utils/` の 2 モジュールが上位 `background/ai` に逆辺参照し（LAYERS.md 違反）、同一概念の allowlist が 3 箇所で drift し、PBI 02 で導入した dynamic-import 回避が load 時の失敗を隠すから。

## BDD受け入れシナリオ

```gherkin
Scenario: utils が background を import しない
  Given cspValidator・urlWhitelist・fetch/ssrfGuard
  When  静的 import グラフを検査する
  Then  background/ai への辺がゼロになる

Scenario: 1 行の行追加で3箇所に反映される
  Given 中立テーブルに新規プロバイダー行を追加する
  When  strategy 生成・allowlist 構築・第二層チェックを実行する
  Then  3 箇所とも新規行を認識する

Scenario: テンプレートフローが静的 import に戻る
  Given ProviderStrategy.executeHttpSummaryFlow
  When  既存 provider テストを実行する
  Then  dynamic import なしに全 green になる
```

## 受け入れ基準
- [x] `cspValidator.ts:14-15` と `urlWhitelist.ts:11` の `background/ai/providerCatalog.js` import が消える
- [x] 低層に中立記述子テーブル（baseURL キー・local フラグ・label・allow-domain 行 + allow 述語）が存在する
- [x] `providerCatalog.ts` は行データ上の薄い adapter（strategy 構築）になる。既存の公開 API（`PROVIDER_CATALOG` / `isAllowedProviderBaseUrl` / `createProviderStrategy`）の呼び出し側は無修正
- [x] catalog 由来の反復（cspValidator loop・urlWhitelist `addProviderBaseUrls`）が中立テーブルに一本化され、catalog 行は中立行を spread して drift 不能になる。静的ドメインリスト（`DEFAULT_ALLOWED_DOMAINS` / `PROVIDER_TO_DOMAIN` / `ALLOWED_AI_PROVIDER_DOMAINS`）は別 gate 用途のため対象外（将来の遡及候補として backlog に記録）
- [x] `ProviderStrategy.ts:291-294` の dynamic import が静的 import に戻り、provider 全テストが green
- [x] 文面・許可判定結果が変更前と同一（リファクタリング。SSRF テスト `2026-09-03-01` の 38 件が green）

## テスト戦略（t_wadaスタイル）
### 単体テスト
- 中立テーブル＋allow 述語の matrix（正常 URL・整数/hex IPv4・IPv6・範囲外）
- catalog adapter が同一行から strategy を生成すること
### 統合テスト
- 既存 provider / fetch / csp / whitelist suite は無修正で green
### 例外ハンドリング
- 不正 baseURL・空 catalog 行の扱いが変更前と同一

## 実装アプローチ
- **Outside-In**: 中立テーブルの行型から設計 → 2 つの utils 読み手を移行 → catalog を adapter 化 → template の import を静的に戻す

## 見積もり
0.5w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: テーブル＋述語は background なしに単体駆動できる
- 非機能要件: 許可判定の文面・結果は不変。ADR 2026-08-29-fetch-redirect-policy / 2026-08-27-limit-policy に抵触しないことを確認
- `providerSecurityPolicy.ts`（141 行）は純粋チェックの現住所。移動先の候補だが、ssrfGuard seam との統合可否は実装時に判断

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "providerCatalog" src/utils/cspValidator.ts src/utils/storage/urlWhitelist.ts
rg -n "DEFAULT_ALLOWED_DOMAINS|PROVIDER_TO_DOMAIN|ALLOWED_AI_PROVIDER_DOMAINS" src/utils/ src/background/ai/ --include="*.ts" | grep -v __tests__
sed -n '285,295p' src/background/ai/providers/ProviderStrategy.ts
```
2026-09-05 時点: 逆辺 2 本（cspValidator:14-15、urlWhitelist:11）。catalog 228 行。PBI 02 の回避コメント付き dynamic import（:286-294）。

### 実装手順
1. 低層（`src/utils/` 配下。ssrfGuard 近傍を推奨）に中立テーブル＋述語を新設
2. cspValidator / urlWhitelist の読みを中立テーブルに付け替え（各ステップで既存テスト green）
3. providerCatalog を行データ上の adapter に薄化（re-export 維持）
4. ProviderStrategy の dynamic import を静的に戻し、provider 全テスト green

### 落とし穴
- `PROVIDER_CATALOG` を import しているテストモックが多数ある — re-export を維持すれば無修正で通る。削除しないこと
- allow 述語の整数/hex/IPv4 デコード分岐（2026-09-03-01 の 38 件）は振る舞いを変えないこと。テーブル移行は述語コードの移動に留める
- `getAllowedUrls()` の chrome.storage 読取は urlWhitelist 側の責務のまま。テーブルは純粋データ＋純粋述語に限定する

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] provider / fetch / csp / whitelist 全テスト green
- [x] コードレビュー完了
- [x] ドキュメント更新（LAYERS.md の逆方向依存禁止に適合した旨を注記。循環 ADR 2026-08-20 とは別件であることを明記）
