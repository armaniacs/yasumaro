# PBI: hmacKeyStore 候補チェーンの内部 seam — implementation 単体テスト可能化

## ステータス: ✅ 完了（2026-09-15）

## ユーザーストーリー

メンテナとして、KEK 候補チェーン（session → legacy local → durable IDB → generate）の順序が implementation 内部の seam 経由でテスト可能であってほしい。なぜなら現在 session/local は chrome 直結合で、チェーン全体を interface 越しにテストできず、将来の KEK ポリシー変更（候補の追加・順序変更）の検証が実ブラウザ頼みになるから。

## 優先度

- 順位: 4 / 本バッチ4件中
- RICEスコア: 3.75（Reach=3 / Impact=0.5 / Confidence=50% / Effort=0.2人週）
- 根拠: Firefox QA で発見した同意リセット修正（`baa087f8`）でチェーンに durable を追加した直後の品質強化。値は小さいが修正直後の領域として重点的に固める

## 背景（診断結果）

- `src/utils/crypto/hmacKeyStore.ts:106-191` — `getOrCreateHmacWrappingKeyLocked` 内の `candidates` 配列が session/local を chrome 直結合。durable のみ seam + override を持ちチェーン全体が interface 越しにテスト不能
- `localStored_Extract` の命名残滓（field アクセスのヘルパーとして不適切な名前）
- Strategy パターンへの抽出は**しない**（One adapter means a hypothetical seam — チェーンの順序は1箇所に集約すべきで、必要なのは implementation 内部の storage 読み注入）

## 実装ガイド

1. **storage 読みを内部 seam に**: `candidates` 配列が参照する session/local 読みを注入可能に（durableKeyStore.ts と同じ override パターン）
   ```ts
   export interface WrappingKeyCandidateStores {
     getSession(): Promise<string | undefined>;
     getLegacyLocal(): Promise<string | undefined>;
   }
   export function setWrappingKeyStoresOverride(s: WrappingKeyCandidateStores | null): void
   ```
2. **`localStored_Extract` を適切な名前に変更**（例: inline に展開して削除）
3. **チェーン順序の正当化コメントを interface ドキュメントに**: session（現行セッション高速パス）→ legacy local（678f879d 時代のエンベロープ互換）→ durable IDB（PBI 09-05・非抽出可能）→ generate の順が生まれた理由
4. **回帰**: hmacKeyStoreRestart.test.ts（durable 永続化の pin）+ crypto.test.ts

### 触ってはいけないもの

- チェーンの順序と候補の集合（本 PBI はテスト容易性のみ — ポリシー変更は別）
- durableKeyStore.ts の API（`setDurableKeyStorageOverride` と同じパターンなので整合を保つ）

## BDD受け入れシナリオ

```gherkin
Scenario: チェーン順序が override 経由でテストできる
  Given session/local/durable の読みを override した状態
  When  getOrCreateHmacWrappingKeyLocked が呼ばれる
  Then  候補の順序どおりの解決と最終生成が観測できる

Scenario: session ヒットが最優先であることが pin される
  Given session と durable の両方に KEK がある
  When  鍵を取得する
  Then  session の値が使われる（優先順位の pin）
```

## 受け入れ基準

- [x] session/local の読みが注入可能（`setWrappingKeyStoresOverride`）になり、チェーン順序が実ブラウザなしでテスト可能（chain テスト3件）
- [x] `localStored_Extract` が削除されている
- [x] チェーン順序の正当化コメントが module ドキュメントに記載されている（PBI 2026-09-15-08 のフォローアップとして session 最優先の pin も追加）
- [x] hmacKeyStore 関連テスト全件 green（chain 3 + restart 2 + crypto 93）

## テスト戦略

- 単体: チェーン順序の pin（session 最優先・legacy fallback・durable・generate）
- 既存: hmacKeyStoreRestart.test.ts（durable 永続化）+ crypto.test.ts が回帰網

## 見積もり

0.5-1日

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（hmacKeyStore.ts 先頭コメントにチェーン順序の理由）
