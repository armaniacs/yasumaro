# PBI: trustDb bloomFilter 非暗号ハッシュ

## ユーザーストーリー
開発者として、`TrustBloomFilter` のデータ整合性ハッシュが偽装耐性を持つようにしたい、なぜなら現行の `simpleHash` は非暗号学的FNV風ハッシュで衝突を容易に作れ、改ざんされたBloom Filterデータが整合性チェックをすり抜ける可能性があるから。

## ビジネス価値
- 信頼ドメイン判定（フィッシング/トラスト判定）の完全性を担保し、改ざんされたBloomデータによる誤判定を防止する
- `bloomFilterFromData` の `hash mismatch` 検証を実効的にし、ストレージ汚染攻撃の検出率を向上させる
- 測定: 改ざんデータ投入時に `hash mismatch` が暗号学的に検出されること、既存 Bloom 機能の後方互換性維持

## 優先度
- 順位: 9 / 17
- RICEスコア: 93（Reach=20 / Impact=2 / Confidence=70% / Effort=0.3）
- 根拠: TrustDb を利用する全ユーザーに影響するがBloom改ざんは限定的な攻撃経路 (Reach=20)。信頼判定の偽陽性/偽陰性は中〜高影響 (Impact=2)。`simpleHash` の脆弱性は確実だがWebCrypto置換のコストと互換性検証が必要で確信度70%。ハッシュ移行と永続データの互換対応で Effort 0.3。

## なぜなぜ分析
- なぜ偽装可能か: `src/utils/trustDb/bloomFilter.ts:162-171` の `simpleHash` は `hash = ((hash << 5) - hash) + char` の32bit非暗号ハッシュで衝突探索が容易。攻撃者は `data` を改ざんしつつ同じ `simpleHash` になる `hash` を付与でき、`bloomFilterFromData:144-148` の検証をバイパス可能
- なぜ非暗号ハッシュを採用したか: 初期実装で「データ破損検出のみ」目的とコメントし（`bloomFilter.ts:160`「セキュリティ用途ではなく」）、暗号学的完全性は不要と判断した
- なぜ見過ごされたか: TrustDb の脅威モデルで「ローカルストレージ改ざん」を想定しておらず、Bloomデータは信頼できる前提で設計された
- なぜWebCryptoを使わなかったか: `SubtleCrypto` が非同期 (`async`) であるため `toData()` / `bloomFilterFromData()` の同期APIを維持する都合で簡易ハッシュを選択した
- 解: `WebCrypto SHA-256`（`crypto.subtle.digest('SHA-256', ...)`）または `HMAC-SHA256` に置換する。同期APIを維持する必要がある場合は段階的移行として (1) まずは同期的に検証可能な `SHA-256` の hex を `simpleHash` と併記し、(2) 次期で非同期APIに移行、または `hmac` 検証を追加する

## BDD受け入れシナリオ

```gherkin
Scenario: ハッピーパス — 正規データは検証をパスする
  Given `bloomFilterFromDomains(["example.com","google.com"])` で生成した `BloomFilterData` (data, hashCount, bitCount, expectedDomainCount, hash)
  When `bloomFilterFromData(data)` を呼ぶ
  Then 例外はスローされず `TrustBloomFilter` が復元され `mightContain("example.com")` が true を返す

Scenario: 攻撃 — 改ざんデータは暗号学的ハッシュで検出される
  Given 正規の `BloomFilterData` の `data` を1文字改ざんした `tamperedData`（例: base64 先頭1文字を置換）
  And 正規の `hash` を `simpleHash(tamperedData.data)` で再計算して付与した偽装データ（simpleHashなら検証をパスしてしまう）
  When `bloomFilterFromData(tamperedData)` を呼ぶ
  Then 修正前は検証をパスしてしまう（脆弱性の再現）
  And 修正後は `hash mismatch` エラーがスローされ復元が拒否される（SHA-256/HMACで検出）
```

## 受け入れ基準
- [x] `src/utils/trustDb/bloomFilter.ts:162-171` の `simpleHash` が `WebCrypto SHA-256` または `HMAC-SHA256` に置換される（または併用移行パスが実装される）
- [x] `TrustBloomFilter.toData():66-79` で生成される `hash` が暗号学的ハッシュ（hex 64文字等）である
- [x] `bloomFilterFromData():142-156` の検証が新ハッシュで改ざんを検出し、`simpleHash` 衝突による偽装が拒否される
- [x] 既存の永続データ（`simpleHash` で保存された古い `BloomFilterData`）の移行パスが定義される（例: 旧hashは警告ログ＋再生成を促す、または両ハッシュ検証で段階移行）
- [x] `npx vitest run src/utils/__tests__/bloomFilter*` および `src/utils/trustDb/__tests__/bloomFilterManager.test.ts` がパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 不要（BloomFilterは内部データ構造）

### 統合テスト
- `bloomFilterFromDomains` → `toData` → `bloomFilterFromData` のラウンドトリップが新ハッシュで成功すること
- 古い `simpleHash` データを `bloomFilterFromData` に投入した際の移行挙動（再生成 or 警告）が検証されること
- `trustDb.ts:172,290` の `bloomFilterFromData(savedDb.bloomFilter)` 経路で改ざんデータが拒否されること

### 単体テスト
- `simpleHash` 衝突ペア（既知の衝突例）を新ハッシュでは衝突しないことのテスト
- `toData()` の `hash` が `SHA-256(base64Data)` の期待値と一致すること（`crypto.subtle` をモックまたは実計算で検証）
- `bloomFilterFromData` に `hash` なし/空文字/不正長さのデータを渡した際のハンドリング
- `uint32ArrayToBase64` / `base64ToUint32Array` の往復不変性は維持されること

## 実装アプローチ
- **Outside-In**: まず改ざん再現テスト（RED）を `bloomFilter-performance.test.ts` または新規 `bloomFilter-security.test.ts` に追加し `simpleHash` では検証をパスしてしまうことを証明 → ハッシュ関数を置換 → GREEN
- **Red-Green-Refactor**: ハッシュ計算を `async` にする場合は `toData()` / `bloomFilterFromData()` のシグネチャ変更影響を `TrustBloomFilter` 利用箇所全てで洗い出す。同期維持が必要なら `SHA-256` の同期ポリフィル（例: 純JS SHA-256）を検討
- **移行戦略**: 既存ユーザーの `chrome.storage.local` に保存された旧 `BloomFilterData` を考慮し、旧hash検出時は `console.warn` + 自動再生成（`createBloomFilterFromPresets`）するフォールバックを実装

## 見積もり
0.3pt（ハッシュ置換 + 非同期対応 + 移行パス + テスト、要チームでの見積もり）

## 技術的考慮事項
- 依存関係: `bloomFilter.ts` は `bloomfilter-vendor.mjs` と `trustDbSchema.ts` に依存。`crypto.subtle` は `chrome extension` 環境で利用可能だが `offscreen` / `service worker` での可用性を要確認
- テスタビリティ: `crypto.subtle.digest` は `async` のためテストでは `await` 必須。Jest/jsdom 環境で `crypto.subtle` が未定義の場合は `@peculiar/webcrypto` ポリフィルまたはモックを用意
- 非機能要件: `SHA-256` は `simpleHash` より遅いが Bloomデータは数KB程度で影響は無視可能。HMAC にする場合は鍵管理（`chrome.storage` にHMAC鍵を保存またはハードコードしない）を別途設計
- 後方互換性: 旧 `simpleHash` データを一律拒否すると既存ユーザーで初回起動時に Bloom 復元が失敗する。段階移行（旧hashは許容しつつ新hashで再保存）が推奨
- セキュリティ: 本PBIは「データ破損検出」から「改ざん検出」への格上げ。完全な改ざん耐性には署名（鍵付きHMAC）が必要だが、まずは衝突耐性のある SHA-256 で第一段階とするか、HMAC まで含めるかを ADR で決定すること

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "simpleHash\|bloomFilterFromData\|toData" src/utils/trustDb/
# 該当: src/utils/trustDb/bloomFilter.ts:66-79,142-171
cat src/utils/trustDb/bloomFilter.ts | grep -A 12 "function simpleHash"
```

### 実装手順
1. `src/utils/trustDb/bloomFilter.ts:162-171` の `simpleHash` 実装を読み、FNV風32bitハッシュであることを確認
2. 置換方針を決定:
   - **案A (推奨・第一段階)**: `crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))` で hex を生成する `async sha256Hex(str)` に置換。`toData()` と `bloomFilterFromData()` を `async` 化する
   - **案B (同期維持)**: 純JSの同期 SHA-256 実装（例: `js-sha256` 軽量ライブラリ）を導入し同期APIを維持
   - **案C (HMAC)**: 拡張機能内で生成したランダム鍵を `chrome.storage.local` に保存し `HMAC-SHA256` で検証（最も強固だが鍵管理が必要）
3. `toData()` の `hash = await sha256Hex(base64Data)` に変更し、`bloomFilterFromData()` でも `await sha256Hex(data.data)` で検証
4. 旧データ移行: `if (data.hash && data.hash.length < 64) { /* 旧simpleHash */ logWarn(...); /* 再生成を促すか許容 */ }` の分岐を追加
5. `src/utils/trustDb/trustDb.ts:172,290,312` の呼び出し側が `await` に対応しているか確認し、必要なら `async` 伝播を修正
6. `npx vitest run src/utils/__tests__/bloomFilter` で検証

### 落とし穴
- `crypto.subtle` は `http` コンテキストでは利用不可 — 拡張機能の `chrome-extension://` と `offscreen` 文脈では利用可能だがテスト環境では要ポリフィル
- `toData()` を `async` にすると `TrustBloomFilter` の全呼び出し元（`trustDb.ts:311` 等）で `await` 漏れが発生しやすい — 型エラーで検出できるよう `Promise<BloomFilterData>` に変更すること
- `base64ToUint32Array` の `atob` は非ASCIIで失敗するが現行データは常にASCII base64なので問題なし — 新ハッシュ導入時に `TextEncoder` のエンコーディングを誤らないこと

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `simpleHash` 衝突による偽装が新ハッシュで拒否されることがテストで証明されている
- [x] 旧 `BloomFilterData` の移行パスが実装または文書化されている
- [x] コードレビュー完了
- [x] ADR またはコメントでハッシュ選定理由（SHA-256 vs HMAC）が記録されている
