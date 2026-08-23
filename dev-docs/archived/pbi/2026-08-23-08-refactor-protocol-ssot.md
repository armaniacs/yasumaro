# PBI-0823a-08: wxt.config ↔ protocol SSOT 完全化

## ユーザーストーリー

開発者として、`wxt.config.ts:36 JSON.stringify(1)` のハードコードを `protocol.ts` の SSOT から導出したい。なぜなら二重定義で片方更新漏れが起き、`loader.ts:22` の fallback `? 1` も残存しているから。

## 優先度

- **順位**: 8 / 8
- **RICE**: 80 (Reach 9 × Impact 0.5 × Conf 90% / Effort 0.2w)
- **根拠**: quick win。5分で終わるが Impact は小さいため最下位。
- **依存**: なし

## BDD受け入れシナリオ

```gherkin
Scenario: wxt.config が protocol.ts からバージョンを読む
  Given protocol.ts の CURRENT_PROTOCOL_VERSION が 1
  When  wxt.config.ts がビルドされる
  Then  define.__PROTOCOL_VERSION__ は 1 になる

Scenario: protocol version を上げても1箇所の変更で済む
  Given protocol.ts の version を 2 に変更
  When  ビルドする
  Then  loader.ts と wxt.config の両方が 2 になる
```

## 受け入れ基準

- [x] `wxt.config.ts:36` を `protocol.ts` からの import 由来に変更
- [x] `loader.ts:22` の fallback `? 1` を削除（`__PROTOCOL_VERSION__` が必ず define されることを型保証）
- [x] `npm run type-check` / `npm test` PASS

## 見積もり

1pt（0.2人週）

## Definition of Done

- [x] 全BDDシナリオ PASS
- [x] ハードコード 1 が0件
- [x] コードレビュー完了
