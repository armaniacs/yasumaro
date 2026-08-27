# PBI: manualContentFetcher SSRF Defense in Depth

## ユーザーストーリー
開発者として、`manualContentFetcher.fetchFromTab` が SSRF ガードをバイパスしないようにしたい、なぜなら `isSecureUrl` だけでは private IP を止められず `chrome.tabs.create` で内部メタデータに到達するから。

## 優先度
- 順位: 3 / 7
- RICEスコア: 1200（Reach=40 / Impact=3 / Confidence=100% / Effort=0.10）
- 根拠: SSRF は内部 Vault への到達に直結。`validateUrl` 呼び出し1行で Effort 小。

## なぜなぜ分析
- なぜバイパスするか: `fetchFromTab` が URL 検証なしで `tabs.create` し、呼び出し元 `recordingHandlers.ts:179` の `isSecureUrl` は http/https のみ
- なぜ二重防御しなかったか: `FETCH_URL` は `validateUrlForFilterImport` で二重検証するのに `MANUAL_RECORD` は単層
- 解: `fetchFromTab` 内で `validateUrl(url, {blockLocalhost:true})` を呼び defense in depth を追加

## BDD受け入れシナリオ
Scenario: ハッピーパス — 外部 https は許可される
  Given `https://example.com` を渡す
  When `fetchFromTab` を呼ぶ
  Then タブが生成される

Scenario: 攻撃 — private IP はブロックされる
  Given `http://169.254.169.254/latest/meta-data/` を渡す
  When `fetchFromTab` を呼ぶ
  Then `private IP` エラーで拒否されタブは生成されない

## 受け入れ基準
- [x] `manualContentFetcher.ts` で `validateUrl` が呼ばれる
- [x] `http://127.0.0.1:27124` と `http://169.254.169.254` がブロックされる
- [x] 既存 164 tests が PASS

## テスト戦略
- 単体: `fetchFromTab` に private IP を渡し拒否されることを検証
- 統合: `handleManualRecord` 経由で SSRF URL がブロックされることを検証
- E2E: 不要

## 見積もり
0.5pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
