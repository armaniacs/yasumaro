# PBI: webhook 宛先の宣言済み port 付きパターン照合修正

## ユーザーストーリー

ローカルで動く小さなブリッジ（MCP 変換等）に記録を送りたいユーザーとして、宣言済み host_permissions のループバック宛先が送信ゲートで有効になってほしい、なぜなら宣言済み 16 パターンが照合不能で無効になっており、ローカル宛の選択肢が現行コードでは 1 つも使えないから。

## 優先度

- 順位: 10 / 10（全候補。PBI 07 の着手前検証で発見した後発起票のため ID は 10。RICE 順では上位 6 番目に相当し、実行順の推奨は 07 より前）
- RICEスコア: 3.0（Reach=1 / Impact=1 / Confidence=75% / Effort=0.25人週）
- 根拠: PBI 07（MCP ブリッジのレシピ文書化）の着手前検証で、webhook エクスポートの宣言済み origin ゲート（defaultIsWebhookHostPermitted → isUrlCoveredByHostPattern、src/background/webhookExport/webhookExportSender.ts:147-192, 204-212）が、パターン ホスト部のポート（例: 127.0.0.1:27123）と URL の parsed.hostname（ポート不含）を直接比較するため、buildLocalHostPermissions 生成の宣言済み 16 ループバックパターン（http|https://127.0.0.1|localhost:27123|27124|11434|1234/*、src/utils/cspDomains.ts:67-77、wxt.config.ts:263-267）のいずれにも一致しないことを、実際のモジュールを vitest で実行して確認した（ループバック URL に一致する宣言パターン 0 件、検証用テストは実行後に削除済み）。平文 http は URL ゲートで（webhookExportPayload.ts:88-95）、公的未宣言 origin は宣言ゲートで拒否されるため、ユーザーが用意できるローカル宛先は現行で 1 つも通らない。不整合は機械検証済みだが、価値の到達はローカル証明書の用意と PBI 07 のレシピ完成にも乗るため Confidence は 75%。修正は純関数 1 箇所とテスト同期のみで Effort 最小

## ビジネス価値

- 宣言済み host_permissions（wxt.config.ts:263-267 が buildLocalHostPermissions から生成）が webhook ゲートで実際に機能し、「未宣言 origin は遮断、宣言済み origin は通る」という宣言パターンの契約が宣言どおりになる
- PBI 07 のレシピ（ローカル HTTPS ブリッジ → MCP 変換）が既存の webhook エクスポート設定だけで動くようになり、コード追加なしのエージェント連携選択肢が提供できる
- 測定方法: 単体 pin（ループバック一致・平文 http 拒否・未宣言 fail-closed の 3 分岐）と e2e ピン 2 同期の緑、既存テスト全緑

## BDD受け入れシナリオ

```gherkin
Scenario: 宣言済みループバック宛先が宣言済み origin ゲートを通る
  Given webhook エクスポートを opt-in で有効化し送信先を https://127.0.0.1:27123/hook に設定した
  And manifest の host_permissions に https://127.0.0.1:27123/* が宣言されている
  When 条件を満たす非公開でない記録の送信を実行する
  Then 照合はパターンの host+port と URL の host+port の比較で行われ一致する
  And 宣言済み origin ゲートは遮断せず送信が行われる

Scenario: 平文 http の宛先は引き続き URL ゲートで拒否される
  Given webhook エクスポートの送信先を http://127.0.0.1:8787/hook に設定した
  When 条件を満たす記録の送信を実行する
  Then URL ゲート（isWebhookUrlAllowed）が https 以外を拒否する
  And 理由 non-https-or-empty-destination でネットワーク前に遮断される

Scenario: 未宣言の公的 origin は引き続き fail-closed で遮断される
  Given webhook エクスポートの送信先を https://example.com/hook に設定した
  And manifest の host_permissions に example.com が宣言されていない
  When 条件を満たす記録の送信を実行する
  Then 理由 undeclared-origin でネットワーク前に遮断される
  And e2e ピン 2 のインライン照合コピーも単体照合と同じ結果を返す
```

## 受け入れ基準

- [x] isUrlCoveredByHostPattern（src/background/webhookExport/webhookExportSender.ts:147-192）は、パターン ホスト部がポートを含む場合、URL の host+port と比較する（parsed.hostname のポート不含比較をしない）
- [x] 宣言済みループバック 16 パターンのいずれかに一致するローカル HTTPS 宛先が、宣言済み origin ゲート（defaultIsWebhookHostPermitted）を通る
- [x] 平文 http:// 宛先は引き続き URL ゲート（isWebhookUrlAllowed、src/background/webhookExport/webhookExportPayload.ts:88-95）で拒否される。同ファイルは変更しない
- [x] 未宣言公的 origin は引き続き fail-closed（undeclared-origin）で遮断される
- [x] testDir/e2e/webhook-egress.spec.ts ピン 2 のインライン照合コピー（106-127 行目付近）が同じ修正で同期されている
- [x] 単体テストが TDD で先に書かれ、ループバック一致・平文 http 拒否・未宣言 fail-closed の 3 分岐を pin している
- [x] manifest.json（wxt.config.ts）への権限追加・削除をしない（既存宣言の活用）

## テスト戦略

コード修正のため自動テスト対象。Outside-In で赤 → 実装 → 緑の順に進める。

### E2Eテスト

- webhook-egress.spec.ts ピン 2 のインライン照合コピーを同期し、実ブラウザの manifest で宣言済みループバックパターンが一致すること・未宣言 origin（example.com）が非一致であることを pin する

### 単体テスト

- isUrlCoveredByHostPattern のポート付きパターン分岐（ループバック URL が一致するようになること・ポートなしパターンは従来どおり・URL 側ポートが宣言と一致しない場合は非一致）
- isWebhookUrlAllowed が平文 http を引き続き拒否すること（webhookExportPayload.test.ts の既存 pin 維持）
- sendWebhookExport が宣言済みループバック宛の送信をゲート通過させること（isHostPermitted に実照合を注入）

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること）

```bash
grep -n "host !== hostname\|parsed.hostname\|parsed.port" src/background/webhookExport/webhookExportSender.ts
grep -rn "isUrlCoveredByHostPattern" src/background/webhookExport/__tests__/webhookExportSender.test.ts testDir/e2e/webhook-egress.spec.ts
grep -n "LOOPBACK_PORTS\|buildLocalHostPermissions\|27123" src/utils/loopbackPorts.ts src/utils/cspDomains.ts wxt.config.ts
```

### 実装手順（Outside-In）

1. 単体の赤を先に書く: ループバック URL（https://127.0.0.1:27123/hook）が宣言済みパターン（https://127.0.0.1:27123/*）に一致しない失敗テストを書き、赤を確認する
2. e2e ピン 2 のインライン照合コピーにも同じ期待を追加し、実ブラウザの manifest で赤を確認する
3. 実装: isUrlCoveredByHostPattern で、パターン ホスト部がポートを含む場合は URL の host+port（parsed.host、デフォルトポートは省略される）と比較する。パターンにポートがない場合は従来どおりの比較を維持する
4. 緑確認: 新 pin の緑 + webhookExportSender.test.ts の既存 pin 群（176-210 行目付近）+ e2e 同期 pin の緑

### 落とし穴

- パターン ホスト部がポートを含む場合のみ host+port 比較に切り替えること。ポート不含パターン（api.github.com/* 等）は従来どおりの比較を維持し、既存 pin テストがすべて緑のままであること。ワイルドカード分岐（*.host）にまで host+port 比較を広げない
- 平文 http:// を許可する実装にしないこと。isWebhookUrlAllowed の https-only は意図的 fail-closed ゲート（webhookExportPayload.ts:81-95 のコメント参照）で、同ファイルは変更しない
- manifest.json（wxt.config.ts）への権限追加をしないこと。修正は既存の宣言済み 16 ループバックパターンを活用する
- 修正後もローカル HTTPS 宛先は OS 信頼の証明書（mkcert 等のローカル CA）が必要（service worker の fetch は通常の TLS 検証に従う）。この注記は PBI 07 のレシピに記載する
- 宣言済み 4 ポートは Obsidian Local REST（27123/27124）・Ollama（11434）・LM Studio（1234）と共有のため、ブリッジは空いている宣言済みポートにバインドする（testDir/e2e/fixtures/localServers.ts の pickLoopbackPort が既存の実装例）
- e2e ピン 2 のインライン照合コピーの同期漏れ。単体と e2e で結果がずれると pin の意味がなくなる

## 見積もり

1pt目安（0.25人週相当）

## Definition of Done

- [x] 照合修正が TDD（赤 → 緑）で実装され、全BDDシナリオが自動テストとしてパスする
- [x] e2e ピン 2 のインライン照合コピーが同期され、単体と e2e で同じ結果を返す
- [x] 既存テスト全緑（webhookExportSender.test.ts の pin 群と webhookExportPayload.test.ts を含む）
- [x] コードレビュー完了
- [x] PBI 07（レシピ文書化）を再実行できる状態

## 参照

- 依存する PBI: [2026-10-31-07-docs-mcp-bridge-recipe.md](2026-10-31-07-docs-mcp-bridge-recipe.md)（ローカル MCP ブリッジのレシピ文書化。本修正の後に再実行する）
- 実装例: testDir/e2e/fixtures/localServers.ts（宣言済みポートでのローカルサーバー起動と空きポート選択）
