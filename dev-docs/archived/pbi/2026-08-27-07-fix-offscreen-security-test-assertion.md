# PBI: offscreen security テストの偽陽性解消

## ユーザーストーリー
開発者として、offscreen の null メッセージ拒否テストが偽陽性を出さないようにしたい、なぜなら現在は assertion がなく常に緑で `return false` 仕様の回帰を検出できないから。

## 優先度
- 順位: 7 / 8
- RICEスコア: 100（Reach=10 / Impact=0.5 / Confidence=100% / Effort=0.05）
- 根拠: テスト品質のみ (Reach=10, Impact=0.5)。修正は 2 行で確実 (Confidence=100%, Effort=0.05)。payloadGuard OOM 等より後回しでよいが一緒に片付ける。

## なぜなぜ分析
- なぜ偽陽性か: `it('rejects null/undefined messages')` が `responses` に push するだけで `expect` がないため
- なぜ気づかないか: `handleOffscreenMessage(null)` は `return false` で `sendResponse` を呼ばず、push が 0 件でもテストは失敗しない
- なぜ assertion を書かなかったか: 「offscreen 非対象は無視」がコメントで意図されたが検証コードに落とし込まれなかった
- 解: `expect(result).toBe(false)` と `expect(responses).toHaveLength(0)` を追加し仕様を固定

## BDD受け入れシナリオ
Scenario: ハッピーパス — null メッセージは無視され false を返す
  Given `message=null` を渡す
  When `handleOffscreenMessage` を呼ぶ
  Then `return false` で `sendResponse` は呼ばれない

Scenario: 異常系 — 不正 target は無視される
  Given `target='background'` のメッセージを渡す
  When `handleOffscreenMessage` を呼ぶ
  Then `return false` で `sendResponse` は呼ばれない

## 受け入れ基準
- [x] `src/offscreen/__tests__/offscreen-security-comprehensive.test.ts:96` に `expect(handleOffscreenMessage(...)).toBe(false)` と `expect(responses).toHaveLength(0)` が追加されている
- [x] `rejects messages not targeted` / `invalid target` の両テストが `return false` を検証する形に修正されている
- [x] 既存 176 ケースがパスする

## テスト戦略
- 単体: `handleOffscreenMessage` の null/undefined/不正 target の分岐を `return` 値で検証
- 統合: 不要
- E2E: 不要

## 見積もり
0.5pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
