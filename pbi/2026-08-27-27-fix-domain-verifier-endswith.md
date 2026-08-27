# PBI: domainVerifier endsWith 誤信頼

## ユーザーストーリー
開発者として、`DomainVerifier.checkJpAnchor` の TLD 判定が `endsWith` の部分一致で誤信頼しないようにしたい、なぜなら `domain.endsWith("example.com")` は `evil-example.com` や `notexample.com` でも `true` を返し、JP-Anchor TLD リストに含まれるドメインのサフィックスを共有する攻撃者ドメインが `TRUSTED` と誤判定される特権昇格の攻撃経路になるから。

## 優先度
- 順位: 4 / 17
- RICEスコア: 420（Reach=20 / Impact=1.5 / Confidence=70% / Effort=0.05）
- 根拠: 信頼判定を利用する全ユーザーに影響 (Reach=20)。誤信頼はセンシティブ判定のバイパスにつながるため Impact は中 (1.5)。`endsWith(tld)` の不備はコード確認で確実だが、実際に JP-Anchor リストと衝突するドメインの出現頻度は中程度のため Confidence=70%。`"." + tld` 境界チェックと `isValidTld` 追加の小修正で Effort 極小。

## なぜなぜ分析
- なぜ誤信頼するか: `src/utils/trustDb/domainVerifier.ts:69` が `domain.endsWith(tld)` のみで判定し、ドット境界を検証しないため
- なぜドット境界が抜けたか: TLD 文字列自体が `example.com` 形式で保存されていることを前提に、完全一致とサブドメイン一致の区別を実装しなかった
- なぜ気づかなかったか: テストが `sub.example.com` 等の正当なサブドメインのみで、`evil-example.com` のような境界違反ケースをカバーしていない
- 解: `domain === tld || domain.endsWith("." + tld)` に修正し、TLD 側の形式を `isValidTld` で事前検証する

## BDD受け入れシナリオ
Scenario: ハッピーパス — 正当なサブドメインは信頼される
  Given `tlds = ["example.com"]`、`domain = "sub.example.com"` を含む state
  When `checkJpAnchor("sub.example.com", state)` を呼ぶ
  Then `level === TRUSTED` かつ `source === "jp-anchor"` を返す

Scenario: ハッピーパス — TLD 完全一致は信頼される
  Given `domain = "example.com"` が TLD と完全一致
  When `checkJpAnchor` を呼ぶ
  Then `TRUSTED` を返す

Scenario: 攻撃 — サフィックス部分一致は信頼されない
  Given `tlds = ["example.com"]`、`domain = "evil-example.com"`
  When `checkJpAnchor` を呼ぶ
  Then `level === UNVERIFIED` を返す

Scenario: 攻撃 — サフィックス偽装は信頼されない
  Given `domain = "notexample.com"`（`example.com` で終わるがドット境界なし）
  When `checkJpAnchor` を呼ぶ
  Then `UNVERIFIED` を返す

Scenario: エッジ — 不正な TLD 形式はスキップされる
  Given `tlds = ["*"]` や空文字を含む不正 TLD
  When `checkJpAnchor` を呼ぶ
  Then 当該 TLD は無視され `UNVERIFIED` を返す（`isValidTld` で除外）

## 受け入れ基準
- [ ] `src/utils/trustDb/domainVerifier.ts:69` が `domain === tld || domain.endsWith("." + tld)` の境界チェックに修正されている
- [ ] 不正 TLD を除外する `isValidTld`（または同等のバリデーション）が追加されている
- [ ] `evil-example.com` / `notexample.com` が `TRUSTED` にならないことをテストで保証する
- [ ] `sub.example.com` / `example.com` が引き続き `TRUSTED` になる（リグレッションなし）
- [ ] `npx vitest run src/utils/trustDb/__tests__/domainVerifier.test.ts` がパスする

## テスト戦略
- 単体: `checkJpAnchor` に完全一致/サブドメイン/サフィックス偽装/ハイフン連結/不正TLDの5パターンを追加
- 統合: `isDomainTrusted` 経由で `evil-example.com` が `UNVERIFIED` になる end-to-end テスト
- E2E: 不要

## 見積もり
0.05pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
