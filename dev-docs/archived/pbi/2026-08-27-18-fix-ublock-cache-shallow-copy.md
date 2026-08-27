# PBI: ublockParser cache 浅いコピー汚染

## ユーザーストーリー
開発者として、`getFromCache` が返すキャッシュ値が呼び出し側の変更で汚染されないようにしたい、なぜなら浅いコピーではネスト配列が共有され、呼び出し側が `push` 等で書き換えると次回キャッシュ取得時に汚染されたデータが返り、パース結果の整合性が崩れるから。

## ビジネス価値
- キャッシュ汚染による誤ったブロック/例外判定を防止し、ユーザーの閲覧制御の信頼性を維持する
- 再現困難な状態汚染バグを未然に防ぎサポートコストを削減する
- 測定: `ublockParser` キャッシュの汚染再現テストが常に成功し、`getFromCache` が deep clone を返すこと

## 優先度
- 順位: 5 / 17
- RICEスコア: 720（Reach=30 / Impact=1.5 / Confidence=80% / Effort=0.05）
- 根拠: uBlock形式を有効化している利用者に限定だが該当環境では全パース結果に影響 (Reach=30)。誤ブロックは中影響 (Impact=1.5)。浅いspreadはコードで確証 (Confidence=80%)。`structuredClone` 1行修正でEffort極小。

## なぜなぜ分析
- なぜキャッシュが汚染されるか: `src/utils/ublockParser/cache.ts:111` の `getFromCache` が `{ ...cached }` の浅いスプレッドで返却するため、ネストされた配列/オブジェクト（例: `blockDomains`, `exceptionRules`）は参照共有される。呼び出し側が `result.blockDomains.push(...)` すると `PARSER_CACHE` 内の実体まで書き換わる
- なぜ浅いコピーで実装されたか: 初期実装で「オブジェクトのコピーを返せば安全」という誤った仮定でスプレッドのみで十分と判断し、ネスト構造の共有を考慮しなかった
- なぜ気づかなかったか: テストがキャッシュ取得後のミューテーションを検証しておらず、読み取り専用ユースケースしかカバーしていない
- なぜ深いコピーにしなかったか: `structuredClone` の可用性や `JSON` シリアライズのコストを検討せず、最小コストのスプレッドを選択した
- 解: `structuredClone(cached)` または `JSON.parse(JSON.stringify(cached))` 等の deepClone に置換する。`structuredClone` が利用不可の環境ではフォールバックを用意する

## BDD受け入れシナリオ

```gherkin
Scenario: ハッピーパス — キャッシュ取得後の変更が次回取得に影響しない
  Given `PARSER_CACHE` に key="abc" で `{ blockDomains: ["a.com"], count: 1 }` が保存されている
  When `getFromCache("abc")` で取得したオブジェクトの `blockDomains.push("evil.com")` を実行する
  And 再度 `getFromCache("abc")` を呼ぶ
  Then 2回目の結果の `blockDomains` は `["a.com"]` のままで `evil.com` を含まない

Scenario: 攻撃 — ネスト配列のpushでキャッシュ汚染が再現し修正後は汚染されない
  Given `saveToCache("k", { rules: { blockDomains: ["x.com"] } })` で保存済み
  When 攻撃者が `const v = getFromCache("k"); v.rules.blockDomains.push("attacker.com")` を実行する
  Then 修正前は `getFromCache("k").rules.blockDomains` が `attacker.com` を含んで汚染される（バグの再現）
  And 修正後は `getFromCache("k").rules.blockDomains` が汚染されず期待配列を維持する
```

## 受け入れ基準
- [ ] `src/utils/ublockParser/cache.ts:108-114` の `getFromCache` が deep clone を返す（`structuredClone` または等価な深いコピー）
- [ ] ネスト配列/オブジェクトを含む値でも呼び出し側の `push`/プロパティ書き換えが `PARSER_CACHE` に波及しないことを単体テストで検証
- [ ] `src/utils/ublockParser/index.ts:120,251` の `getFromCache` 呼び出し経路で汚染が再現しないこと
- [ ] `npx vitest run src/utils/__tests__/ublockParser*.test.ts` および `src/utils/ublockParser/__tests__/**` がパスする（既存29ケース維持）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 不要（キャッシュは内部最適化でありユーザー可視E2Eシナリオなし）

### 統合テスト
- `parseUblockFilterListWithErrors` → `saveToCache` → `getFromCache` → ミューテート → 再取得 の往復で汚染がないことを検証

### 単体テスト
- `getFromCache` にネスト配列/二重ネストオブジェクトを保存し、取得後の `push` / `obj.nested.x = 1` がキャッシュに影響しないこと
- `structuredClone` フォールバック分岐（`globalThis.structuredClone` 未定義時の `JSON` 経路）のテスト
- `hasCacheKey` / `clearCache` / `saveToCache` との相互作用に回帰がないこと

## 実装アプローチ
- **Outside-In**: まず汚染再現テスト（RED）を `ublockParser/cache.test.ts` に追加し失敗を確認 → `getFromCache` を修正 → GREEN → リファクタ
- **Red-Green-Refactor**: deepClone ヘルパーを `cache.ts` 内に切り出し、テスト容易性を確保
- **リファクタリング**: `saveToCache` 側でも外部参照共有を防ぐため保存時にも clone するか検討し、必要なら両方向で防御

## 見積もり
0.05pt（1行修正 + テスト追加、要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（`cache.ts` は `constants.ts` のみに依存する独立モジュール）
- テスタビリティ: `PARSER_CACHE` はモジュール内 `Map` であり `clearCache()` でテスト間リセット可能。`globalThis.structuredClone` を一時的に `undefined` にしてフォールバックをテストする
- 非機能要件: 性能影響は軽微。`structuredClone` は `JSON` より高速かつ `Date`/`RegExp` 等も扱えるが、本キャッシュ値はプレーンオブジェクトのためどちらでも可
- 互換性: `structuredClone` が未対応の旧環境（Node 16以下/Jest環境）では `JSON.parse(JSON.stringify(...))` にフォールバック

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "getFromCache\|PARSER_CACHE" src/utils/ublockParser/
# 該当: src/utils/ublockParser/cache.ts:108, src/utils/ublockParser/index.ts:120,251
```

### 実装手順
1. `src/utils/ublockParser/cache.ts:108-114` を読む — 現在 `return { ...(PARSER_CACHE.get(key) as Record<string, unknown>) }` の浅いコピーであることを確認
2. 汚染再現テストを `src/utils/ublockParser/__tests__/cache.test.ts`（または既存テスト）に RED として追加
3. `getFromCache` を `structuredClone` で deep clone する実装に置換:
   ```ts
   export function getFromCache(key: string): unknown | null {
     if (PARSER_CACHE.has(key)) {
       updateLRUTracker(key);
       const cached = PARSER_CACHE.get(key);
       // structuredClone があればそれを使い、なければ JSON フォールバック
       const clone = typeof globalThis.structuredClone === 'function'
         ? globalThis.structuredClone(cached)
         : JSON.parse(JSON.stringify(cached));
       return clone;
     }
     return null;
   }
   ```
4. 必要なら `saveToCache` でも `structuredClone(value)` を保存し外部参照の事後変更を防ぐ
5. `npm run type-check && npx vitest run src/utils/ublockParser` で検証

### 落とし穴
- `structuredClone` は `function` をクローンできないが本キャッシュ値はデータのみなので問題なし — 誤って関数を含む値をキャッシュしないこと
- `JSON` フォールバックは `undefined`/`Infinity` を失うため、将来キャッシュ値にそれらが含まれる場合は `structuredClone` 必須
- テストで `Map` の内容を直接参照しないこと — 必ず `getFromCache` 経由で検証すること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `getFromCache` がネスト構造でも汚染されないことがテストで証明されている
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（必要なら `cache.ts` のコメントに deep clone の意図を追記）
