# PBI: crypto codec の統合 — atob/btoa 直書きの全廃

## ステータス: ✅ 完了（2026-09-16）

codec 部分（項目1・2）を完了。HMAC 統合（項目3）と `hashUrl` 移動（項目4）は性質が異なるため [[2026-09-16-04-refactor-hmac-signer]] に分離した。

### 着手時に判明した前提のズレ

PBI は「最低6箇所」「機械的置換が主作業」としていたが、実測では **28箇所・11ファイル**あり、うち3種類は単純置換できなかった。

| 種別 | 対処 |
|---|---|
| UTF-8 テキスト（2箇所） | `btoa(unescape(encodeURIComponent(s)))` はバイト列用 codec と入力の型も意味も違う → `textToBase64` / `base64ToText` を追加 |
| URL-safe base64（2箇所） | `.replace()` 3連の重複。PBI のユーザーストーリーが挙げていた「URL-safe 化」そのもの → `bytesToBase64Url` ほか4関数を追加 |
| チャンク最適化（bloomFilter） | seam は1文字ずつ連結で 2MB に 106ms、bloomFilter は32KBチャンクで 39ms → **チャンク方式を seam 側に移し全呼び出し元が恩恵を受けるようにした** |

### 置換してはいけなかった箇所

`kdfNegotiator.ts` の `new TextEncoder().encode(atob(secretB64))` は `base64ToBytes` と**結果が異なる**。

```
TextEncoder経由: [0, 1, 195, 136, 195, 191, 194, 128]
base64ToBytes  : [0, 1, 200, 255, 128]
```

0x80 以上のバイトが UTF-8 で2バイトに膨らむ。legacy 鍵の導出を再現する箇所であり、置換すると**既存の暗号化済み API キーが復号不能になる**。理由をコード内コメントに明記して残した。

### テストのモック修正（4ファイル）

`crypto/index.js` を丸ごと差し替えるモックが codec を含まず失敗した。`importOriginal` で実装を取り込み HMAC のみ差し替える形に変更。codec を stub にするとエンコード結果を検証するテストが何も検証しなくなるため。結果として**本物の codec で既存の期待値が通ること**が互換性の実証になっている。

### 結果

- atob/btoa 直書き: **28箇所 → 実質2箇所**（seam 本体 + 意図的な legacy 互換）
- `npm run validate`: 12,089 件グリーン

## ユーザーストーリー

メンテナとして、バイト↔文字列の codec 変更（URL-safe 化・巨大入力ガード等）が1箇所の修正で全呼び出しに効くようにしたい。なぜなら `bytesToBase64` / `base64ToBytes` を提供しながら、最低6箇所が `atob` / `btoa` を直書きしており、codec の seam を迂回しているから。

## 優先度

- 順位: 4 / 本バッチ4件中
- RICEスコア: 8.0（Reach=6 / Impact=1 / Confidence=80% / Effort=0.6人週）
- 根拠: KdfNegotiator（PBI 13）と合わせて crypto cleanup の残り。機械的置換が主作業

## 背景（診断結果）

- 同一ファイル内の seam 迂回: `src/utils/crypto/primitives.ts` が `bytesToBase64` / `base64ToBytes` を提供しながら、`decrypt:170-171` が `Uint8Array.from(atob(...))` を直書きし、`computeHMAC:279`・`hashPasswordWithPBKDF2:315` が `btoa(String.fromCharCode(...))` を直書き
- 呼び出し側の迂回: `encryptionSession.ts:46,138,141,272,449,461`（atob/btoa 直書き）、`settingsMigration.ts:117-118,121-128`（atob + importKey + deriveKey 手書き — PBI 13 で KdfNegotiator に置換済み）、`settingsExportImport.ts:177`（btoa 直書き）、`importPipeline.ts:96-97`（`base64ToBytesTyped` — 3つ目の並行 codec 実装）
- HMAC の2系統分裂: `primitives.computeHMAC(secret: string, ...)` と `hmacKeyStore.generateHmacSignature(data, key: CryptoKey)` — 呼び出し側は鍵形式で使い分けを強制されている（`settingsExportImport.ts:11` 前者、`urlNotificationHandlers.ts:7` 後者）
- `hashUrl` は crypto から追放候補（logger 側 privacy concerns に移動 — locality 向上）

## 実装ガイド

1. **atob/btoa 直書きの全廃**: `primitives.ts` 内の2箇所 + `encryptionSession.ts` の6箇所 + `settingsExportImport.ts:177` を `bytesToBase64` / `base64ToBytes` に置換
2. **`base64ToBytesTyped` の統合**: `importPipeline.ts:96` の別実装を `base64ToBytes` に一本化（型差異がある場合は互換ラッパー）
3. **HmacSigner に一本化**:
   ```ts
   interface HmacSigner { sign(data: string): Promise<string>; verify(data: string, sig: string): Promise<boolean>; }
   ```
   `computeHMAC`（文字列鍵）と `generateHmacSignature`（CryptoKey 鍵）の2系統を鍵取得を内部で吸収する1つの seam に統合し、`settingsExportImport.ts:11` と `urlNotificationHandlers.ts:7` の使い分けを解消
4. **`hashUrl` の移動**: crypto から logger/privacy 側に移動（locality 向上 — crypto は暗号操作のみに）
5. **回帰**: crypto.test.ts / encryptionSession テスト / settingsExportImport テストが回帰網

### 触ってはいけないもの

- KdfNegotiator（PBI 13 で実装済み — この PBI は codec と HMAC のみ）
- 暗号形式（GCM / PBKDF2 の iteration 値・envelope 形式は不変）

## BDD受け入れシナリオ

```gherkin
Scenario: codec 変更が全呼び出しに1箇所で効く
  Given bytesToBase64/base64ToBytes が唯一の codec seam である
  When  codec の動作（例: URL-safe 化）を変更する
  Then  6箇所の atob/btoa 直書きが存在しないため変更が1箇所で完結する

Scenario: HMAC 鍵形式の使い分けが消える
  Given HmacSigner が鍵取得を内部で吸収している
  When  settingsExportImport と urlNotificationHandlers が署名する
  Then  同一の seam 経由になり鍵形式の知識が呼び出し側から消える
```

## 受け入れ基準

- [x] `src/` 内の `atob` / `btoa` 直書きが（legacy 互換 shim を除き）ゼロになっている
- [x] `base64ToBytesTyped` の別実装が `base64ToBytes` に統合されている
- [ ] ~~`HmacSigner` 統合により鍵形式の使い分けが解消されている~~ → [[2026-09-16-04-refactor-hmac-signer]] に分離
- [ ] ~~`hashUrl` が crypto から移動している~~ → 同上
- [x] crypto / encryptionSession / settingsExportImport テスト全件 green

## テスト戦略

- 既存: crypto.test.ts / encryptionSession / settingsExportImport テストが回帰網
- 単体: HmacSigner の鍵形式2種の互換テスト

## 見積もり

2-3日（KdfNegotiator（PBI 13）と同じ領域のため実装順は 13 の後に置く）

## Definition of Done

- [ ] 全BDDシナリオが完了している
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（primitives.ts 先頭コメントに責務分割）
