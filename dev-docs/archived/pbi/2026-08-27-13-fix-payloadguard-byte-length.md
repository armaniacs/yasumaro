# PBI: payloadGuard バイト長判定修正

## ユーザーストーリー
開発者として、payloadGuard のペイロードサイズ判定が文字数ではなくバイト長で正しく行われるようにしたい、なぜなら絵文字やCJK文字で1MB制限を2-3倍迂回できSQLite/OPFSへ超過投入可能な攻撃経路になるから。

## 優先度
- 順位: 1 / 17
- RICEスコア: 4800（Reach=80 / Impact=3 / Confidence=100% / Effort=0.05）
- 根拠: 全SQLite書き込みに影響 (Reach=80)。DoS/ストレージ枯渇の直接的攻撃 (Impact=3)。TextEncoder未使用は確信100%。1関数修正でEffort極小。

## なぜなぜ分析
- なぜバイパスできるか: `stringExceeds` が `value.length` (UTF-16 units) と `MAX_PAYLOAD_STRING_BYTES` (bytes) を比較するため
- なぜ `TextEncoder` を使わなかったか: 初期実装でバイトと文字数を同一視し、サロゲートペアの差を考慮しなかった
- なぜ気づかなかったか: テストがASCIIのみで検証し絵文字/CJKのバイト差をカバーしていない
- 解: `new TextEncoder().encode(value).byteLength` または `Blob.size` でバイト長判定に修正

## BDD受け入れシナリオ
Scenario: ハッピーパス — ASCII 1MB以内は許可される
  Given `a` を 1,000,000 文字含む payload
  When `assertPayloadSize` を呼ぶ
  Then `null` (許可) を返す

Scenario: 攻撃 — 絵文字で1MBバイト超過は拒否される
  Given 絵文字 `😀` (4bytes, length 2) を 300,000 個含む payload (1.2MB bytes, length 600k)
  When `assertPayloadSize` を呼ぶ
  Then `Payload too large` エラーを返す

## 受け入れ基準
- [x] `src/offscreen/payloadGuard.ts:36` の `stringExceeds` がバイト長で判定する
- [x] `totalBytes` 集計 (`payloadGuard.ts:86-88`) もバイト長で加算する
- [x] `npx vitest run src/offscreen/__tests__/payloadGuard-comprehensive.test.ts` が絵文字/CJKケースを含めてパスする

## テスト戦略
- 単体: `stringExceeds` に ASCII/CJK/絵文字/サロゲートペアの境界値テスト、バッチ合計のバイト集計テスト
- 統合: offscreen 経由の `SQLITE_INSERT` で絵文字 1.2MB payload が拒否されることを検証
- E2E: 不要

## 見積もり
0.5pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
