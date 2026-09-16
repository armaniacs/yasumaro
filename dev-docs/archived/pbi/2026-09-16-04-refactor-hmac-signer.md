# PBI: HMAC の2系統を HmacSigner に統合する

## ステータス: ✅ 完了（2026-09-16）

HMAC 統合を完了。`hashUrl` の移動は層構造への影響が独立した論点のため [[2026-09-16-05-refactor-hash-url-locality]] に分離した。

### 採った方針: エンコーディングは signer の属性とする

`computeHMAC` と `generateHmacSignature` はアルゴリズム（HMAC-SHA256）が同一で、差は**鍵の受け取り方と出力形式**だけだった。しかし出力形式を片方に揃えると、**必ずもう片方の既存署名が壊れる**。

| 署名 | 保存先 | 形式 |
|---|---|---|
| 設定エクスポート | ユーザーのディスク上のファイル | 標準 base64 |
| ログエクスポート | 同上 | 標準 base64 |
| プライバシー同意 | `chrome.storage.local` | URL-safe |
| 通知ID | 通知の id（短命） | URL-safe |

上2つはユーザーの手元にあり、拡張機能を更新しても書き換えられない。そこで**エンコーディングを signer の属性**とし、用途ごとに既存の形式を維持した。PBI のユーザーストーリーは「鍵の形式を意識せずに済むこと」であり、出力形式の統一は要求していない。

### 副産物: 検証の定数時間比較が構造的に保証された

`computeHMAC` 経路は検証時に呼び出し側が `constantTimeCompare` する設計で、**忘れればタイミング攻撃の穴**になった。`HmacSigner.verify` は常に定数時間比較を行うため、忘れようがない。

### 互換性の実証

`hmacSigner.test.ts` で、既存関数と**バイト単位で一致すること**を確認済み（空文字列・日本語・絵文字・5000文字を含む）。

### テストのモック修正（8ファイル）

署名関数を差し替えるモックが signer 経由の実装に届かなくなったため、signer を直接モックする形へ移行した。「署名が一致する/しない」「検証が実際に走る」という**検証の意図は変えていない**。

## ユーザーストーリー

メンテナとして、HMAC で署名するときに鍵の形式を意識せずに済むようにしたい。なぜなら現在は `computeHMAC`（文字列鍵）と `generateHmacSignature`（CryptoKey 鍵）の2系統があり、呼び出し側が鍵の取得方法まで知らされているから。

## 優先度

- 順位: 未定
- 根拠: [[2026-09-15-16-refactor-crypto-codec]] の残項目。codec 部分は完了済みで、これは独立して着手できる。ただし署名の互換性に関わるため慎重な検証が要る

## 背景

2026-09-15-16 は codec と HMAC の両方を対象にしていたが、性質が異なるため分離した。codec は入出力が閉じた変換で機械的に検証できるのに対し、HMAC は**既存の署名済みデータとの互換性**が絡む。

## 現状

### 2系統に分裂している

| 関数 | 鍵の形式 | 呼び出し元 |
|---|---|---|
| `computeHMAC(secret: string, data)` | 文字列 | `settingsExportImport.ts`（5箇所）・`importLogsService.ts`・`exportLogsService.ts` — 計 **5ファイル11箇所** |
| `generateHmacSignature(data, key: CryptoKey)` | CryptoKey | `urlNotificationHandlers.ts`・`privacyConsent.ts`・`hmacKeyStore.ts` — 計 **3ファイル5箇所** |

呼び出し側は鍵の取得方法（`getHmacSecret()` か `getNotificationHmacKey()` か）で使い分けを強制されている。

### 出力形式も異なる

`generateHmacSignature` は URL-safe base64（`bytesToBase64Url`）を返すが、`computeHMAC` は標準 base64 を返す。統合するなら**どちらの出力を維持するかを署名対象ごとに決める**必要がある。

## 実装ガイド

```ts
interface HmacSigner {
  sign(data: string): Promise<string>;
  verify(data: string, sig: string): Promise<boolean>;
}
```

鍵取得を内部に隠し、呼び出し側からは `sign` / `verify` だけが見える形にする。

あわせて `hashUrl` を crypto から logger/privacy 側へ移す（crypto は暗号操作のみに絞る — locality 向上）。

## 最大の論点: 署名の互換性

**既存の署名済みデータを読めなくしてはならない。**

- 設定のエクスポートファイル（ユーザーの手元にある）
- ログのエクスポートファイル
- 保存済みのプライバシー同意（署名付き）
- 通知ID（短命なので影響は小さい）

統合によって署名アルゴリズムや出力形式が変わると、これらが検証に失敗する。**着手時はまず「どの署名がどこに永続化されているか」を洗い出すこと。**

`generateHmacSignature` の出力形式を変えると通知IDが壊れる点は、2026-09-15-16 の作業中にテストが検出した実績がある（`urlNotificationHandlers.test.ts` がエンコード結果を直接検証している）。

## 受け入れ基準

- [ ] `HmacSigner` 統合により鍵形式の使い分けが解消されている
- [ ] `hashUrl` が crypto から移動している
- [ ] 既存の署名済みデータ（エクスポートファイル・保存済み同意）が引き続き検証に成功する
- [ ] crypto / settingsExportImport / privacyConsent / urlNotificationHandlers テスト全件 green

## テスト戦略

- 統合前の実装で署名を生成し、統合後の実装で検証が通ることを固定するテストを先に書く（互換性の回帰網）
- 鍵形式2種それぞれの sign/verify ラウンドトリップ

## 備考

`hashUrl` の移動は HMAC 統合と独立している。先に片付けても構わない。

関連: [[2026-09-15-16-refactor-crypto-codec]]（codec 部分・完了済み）
