# PBI: エクスポート署名に KDF iteration 数を含めて改変耐性を強化する

種別: fix
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

設定をエクスポート/インポートするユーザーとして、エクスポートファイルの KDF パラメータ改変が検出され、改変ファイルによる import 時のハングが起きない状態を目指す。なぜなら、現在の HMAC ペイロードは `ciphertext:iv:salt` のみで iterations を含まないため、署名が valid なまま iterations を 2^31 に改変して import をブロックできるから。

## 優先度

- 順位: 12 / 13
- RICE スコア: 2.0(Reach=1 / Impact=1 / Confidence=1.0 / Effort=0.5)
- 根拠: 攻撃前提かつエクスポート/インポート利用者に限られるが、v1 ファイルが HMAC を通らない点を含め署名の意味を正す価値はある。

## 証拠(レビュー由来・反証済み)

- `src/utils/settingsExportImport.ts:200`(エクスポート時)と `:264`(検証時)— `hmacPayload = `${ciphertext}:${iv}:${salt}`` で iterations を含まない
- `:285` — `encryptedData.iterations` を KDF 候補として採用
- `src/utils/crypto/kdfNegotiator.ts:57-62` — stored iterations を最優先・上限なしで候補化(`storedIterations > 0` のみ)。インポートにタイムアウトなし
- `:260-274` — v2 ガード。v1 ファイル(`:310`)は `hmac` が存在する場合のみ検証するため、`version:"1"` + hmac 省略のファイルは署名検証を完全にスキップできる
- 反証済みの範囲: 改変 iterations=1 でパスワード総当たりが可能にはならない(ciphertext 自体は 600k で暗号化済み)。成立するのは DoS(import ハング)のみ

## BDD 受け入れシナリオ

```gherkin
  Scenario: 新形式のエクスポートで iterations 改変が検出される
    Given v3 形式(署名に iterations を含む)でエクスポートしたファイルがある
    When iterations を 2147483647 に改変する
    Then HMAC 検証が失敗し import が拒否される

  Scenario: 既存の v2 エクスポートは引き続き import できる
    Given 現行形式(v2)でエクスポートした署名付きファイルがある
    When import する
    Then 従来どおり検証・復号される

  Scenario: KDF 候補に上限が適用される
    Given KDF 候補に 2147483647 が含まれる
    When deriveKeyWithIterations が呼ばれる
    Then 上限を超える候補は採用されず棄却される
```

## 受け入れ基準

- [x] 新形式(または v2 拡張)の HMAC ペイロードに iterations を含める
- [x] 旧形式(v1/v2)の検証は後方互換を維持し、既存ユーザーのエクスポート資産が壊れない
- [x] `kdfNegotiator` に iteration 候補の ceiling(6,000,000 相当)を追加する
- [x] v1 の hmac 省略ファイルの扱いを明示的に決める(拒否 or warn 付き許可)し、その挙動をテストで固定する
- [x] PBI 4(KDF iteration 上下限)と上限値を共有する(SSOT)

## テスト戦略

### 統合
- v3 改変拒否、v2 継続 import、v1 hmac 省略の挙動を検証する

### 単体
- kdfNegotiator の ceiling 棄却を検証する

## 実装アプローチ

1. エクスポート形式のバージョンを上げ、hmacPayload の構築を 1 箇所に集約する(export/import で同一関数)
2. `kdfNegotiator` の上限は PBI 4 と同じ定数を参照する

## 制約

- 既存エクスポート資産が import できなくならない
- 署名鍵の取り扱い(`exportHmacSigner`)を変更しない

## 見積もり

2 SP

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
