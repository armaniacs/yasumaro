# PBI: TrustPolicy orphan singleton 解消 — fallback 撤廃と TrustDecision stale キャッシュ排除

## ユーザーストーリー
記録ゲートの整合性を担う開発者として、`getTrustPolicy()` の orphan fallback と `TrustDecision` の stale キャッシュを解消したい、なぜなら現在は `TrustDbKernel` 初期化前に `getTrustPolicy()` が生成する孤立した Policy インスタンスを `TrustDecision` が module-init 時に capture し、`TrustDbAdmin.initialize()` が Kernel 内の Policy だけを更新するため `trustDecision.policy` が永久に stale なままとなり、すべての `isTrusted()` 呼び出しが `UNVERIFIED` を返し whitelisted / sensitive 分類が全ページで誤判定されるから

## 優先度
- 順位: 02（0902a ブランチレビュー — Critical business-logic finding）
- RICEスコア: **4.8**（Reach=High(1) / Impact=3 / Confidence=0.8 / Effort=0.5）
- 根拠: Reach は全記録ページ（engagement event ごとに recording gate が実行されるため High）。Impact 3 は whitelisted / sensitive 分類が全ページで誤り trust bypass が恒常化する圧倒的な影響。Confidence 80% は `TrustPolicy.ts:103` / `TrustDecision.ts` / `TrustDbAdmin.ts` のコードパスで再現可能だが初期化順序の分岐が残るため。Effort 0.5人週は `getTrustPolicy()` の fallback 削除と `TrustDecision` の policy 参照を admin seam 経由に置換する小規模修正。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ orphan Policy が生成される？ | `src/utils/trustDb/TrustPolicy.ts:103` の `getTrustPolicy()` が `__trustDbKernel` 未初期化時に `new TrustPolicy({ save: async () => {} })` の fallback を生成する → Kernel 初期化前の呼び出しが孤立インスタンスを作る → fallback 生成を廃止し常に `getTrustDbAdmin().getPolicy()` に委譲する |
| なぜ TrustDecision が stale を掴む？ | `src/utils/trustDb/TrustDecision.ts` が module-init で `export const trustDecision = new TrustDecision()` を実行し、コンストラクタのデフォルト引数 `policy = getTrustPolicy()` で orphan を capture する → Kernel 初期化後も `this.policy` が更新されない → `TrustDecision` は policy を cache せず呼び出しごとに admin seam から lookup する |
| なぜ Admin 初期化で refresh されない？ | `TrustDbAdmin.initialize()` は `kernel.initialize()` → `kernel.getPolicy()` の Policy だけを更新し、`trustDecision.policy` への伝播がない → `TrustDecision` が stale 参照を保持し続ける → refresh 不要な設計（毎回 lookup）に変えるか、明示的な再バインドを入れる |
| なぜ 2 回目以降も UNVERIFIED？ | orphan Policy は `initialized=false`, `database=null`, `bloomFilter=null` のまま → `isDomainTrusted()` のガード `if (!initialized || !database || !bloomFilter)` が常に `UNVERIFIED` を返す → 正規の Kernel-backed Policy を使えば `DomainVerifier` / `BloomFilterManager` / `TrancoManager` の判定が有効になる |
| なぜ tranco 更新が反映されない？ | orphan の `trancoManager.trancoSet` は空集合のまま、Kernel 側の `updateTranco()` が orphan に伝わらない → 呼び出しごとに admin の Policy を参照すれば `TrancoManager` のキャッシュが常に最新になる |

## BDD受け入れシナリオ

### Scenario: Happy path — 初期化後は kernel の実際の verdict が返る
  Given `TrustDbAdmin` が `initialize()` で `TrustDatabase` と `TrustBloomFilter` を load / repair 済みである
  And `TrustPolicy`（Kernel-backed）が `example.com` を `TRUSTED` と判定する状態である
  When `trustDecision.isTrusted('https://example.com/page')` または `getTrustPolicy().isDomainTrusted('example.com')` を呼ぶ
  Then `level === DomainTrustLevel.TRUSTED`（または `SENSITIVE`）の結果が返る
  And `level === DomainTrustLevel.UNVERIFIED` かつ `reason === 'Trust database not initialized'` ではない

### Scenario: 初期化前呼び出しは orphan を cache せず stale 判定を返さない
  Given `TrustDbKernel` が未初期化（`_resetTrustDbAdminForTest()` / `_resetTrustPolicyForTest()` 直後）である
  When `isTrusted('https://example.com')` を呼ぶ（または `getTrustPolicy()` を呼ぶ）
  Then 例外を throw する、または `UNVERIFIED` であっても orphan cache を生成せず定義された sentinel（例: `TRUST_DB_NOT_INITIALIZED` エラー）を返す
  And その後に `TrustDbAdmin.initialize()` を実行してから `isTrusted('https://example.com')` を再呼び出しすると、正規の kernel-backed verdict が返る（1 回目の orphan が 2 回目に影響しない）

### Scenario: tranco 更新が後続の isTrusted に伝播する
  Given `TrustDbAdmin.initialize()` 済みで `example.com` が初期状態では `UNVERIFIED` である
  When `TrustDbAdmin.updateTranco(['example.com'], 'top')` または `updateTrancoVersion('2026-09-03', ['example.com'])` で tranco を更新する
  And `isTrusted('https://example.com')` を再呼び出しする
  Then 更新後の tranco 集合に基づく判定（`TRUSTED` / `isTrancoDomain() === true`）が返る
  And orphan Policy の `trancoSet` を参照していないことが `getTrustDbAdmin().getPolicy().isTrancoDomain('example.com') === true` で確認できる

### Scenario: TrustDecision が module-init で orphan を capture しない
  Given `TrustDecision.ts` の `export const trustDecision = new TrustDecision()` が存在する
  When モジュールを import した直後（`TrustDbAdmin` 未初期化）に `trustDecision` の内部 policy 参照を確認する
  Then コンストラクタで `getTrustPolicy()` の戻り値を `this.policy` に固定キャッシュしていない
  And `isTrusted()` 呼び出し時に `getTrustDbAdmin().getPolicy().isDomainTrusted()` 経由で最新の Policy を lookup している

### Scenario: getTrustPolicy が常に admin の Policy に委譲する
  Given 任意のタイミングで `getTrustPolicy()` を呼ぶ
  When `__trustDbKernel` の有無に関わらず呼び出す
  Then `new TrustPolicy({ save: async () => {} })` の fallback 生成コードが存在しない
  And 戻り値が `getTrustDbAdmin().getPolicy()` と同一インスタンス（`===`）である

## 受け入れ基準
- [ ] `src/utils/trustDb/TrustPolicy.ts` の `getTrustPolicy()` から `new TrustPolicy({ save: async () => {} })` の fallback 生成が削除され、常に `getTrustDbAdmin().getPolicy()` に委譲する実装になっている（`if (_policyInstance) return` の orphan 再利用も削除）
- [ ] `src/utils/trustDb/TrustDecision.ts` が `this.policy: TrustPolicy` の固定キャッシュを持たず、`isTrusted()` / `isDomainTrusted()` 呼び出しごとに `getTrustDbAdmin().getPolicy()`（または admin seam）から Policy を lookup している
- [ ] `export const trustDecision = new TrustDecision()` の module-init singleton が orphan を capture しない（コンストラクタのデフォルト引数 `policy = getTrustPolicy()` による eager capture が排除されている）
- [ ] 初期化前に `isTrusted()` を呼んだ場合、orphan を生成・cache せず、throw するか定義された sentinel を返し、後続の `initialize()` 後の呼び出しが正規 verdict を返す
- [ ] `TrustDbAdmin.initialize()` 後に `isTrusted('example.com')` が `UNVERIFIED` ではなく kernel の実際の `TrustResult`（`TRUSTED` / `SENSITIVE` / `UNTRUSTED` 等）を返す
- [ ] `TrustDbAdmin.updateTranco()` / `updateTrancoVersion()` 後に後続の `isTrusted()` が更新後の判定を返す（orphan の `trancoSet` ではなく Kernel-backed Policy の `trancoSet` が使われる）
- [ ] 既存の TrustDecision / TrustDb 関連テストが新 seam 経由で green（`npm test -- src/utils/trustDb` および `TrustDecision` テスト）
- [ ] `npm run validate`（type-check + tests）が green、`grep -rn "new TrustPolicy" src/utils/trustDb/TrustPolicy.ts` が fallback 生成 0 件

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 記録ゲートの E2E: `TrustDbAdmin.initialize()` → `trustDecision.isTrusted('https://example.com')` が whitelisted domain で `trusted: true` を返すシナリオを service worker 統合テストで検証

### 統合テスト
- 初期化順序テスト: `_resetTrustDbAdminForTest()` / `_resetTrustPolicyForTest()` 後に `getTrustPolicy()` → `initialize()` → `isDomainTrusted()` の順で呼び、1 回目が orphan を残さず 2 回目が正規 verdict を返すことを検証
- tranco 伝播テスト: `updateTranco(['example.com'], 'top')` 後に `isTrusted('https://example.com')` と `getTrustDbAdmin().getPolicy().isTrancoDomain('example.com')` がともに更新を反映することを検証
- TrustDecision singleton テスト: `trustDecision` import 直後に `isTrusted()` を呼ぶ前後で `getTrustDbAdmin().getPolicy() === getTrustPolicy()` が成り立つことを検証

### 単体テスト
- `getTrustPolicy()` が `getTrustDbAdmin().getPolicy()` に委譲し `new TrustPolicy` を呼ばないことを spy / mock で検証（`vi.spyOn` で `TrustPolicy` コンストラクタ呼び出し 0 回）
- `TrustDecision` が `this.policy` を constructor で固定せず、メソッド呼び出しごとに `getTrustDbAdmin().getPolicy()` を呼ぶことを検証（`getTrustDbAdmin` を mock し呼び出し回数を assert）
- 初期化前 `isTrusted()` が throw するか sentinel を返し、orphan cache を生成しないことを検証（`_policyInstance` が null のままであることを `_resetTrustPolicyForTest` 後の状態で確認、または fallback コードが存在しないことを静的アサート）
- `isDomainTrusted` の `UNVERIFIED` ガードが orphan 由来ではなく正規の未初期化 path でのみ発火することを検証（初期化済みでも `database` / `bloomFilter` が null でない場合に `UNVERIFIED` を返さない）

## 実装アプローチ
- **Outside-In**: 失敗する BDD シナリオテスト（Happy path / Bypass blocked / Refresh）から開始し、単体テストで `getTrustPolicy` の委譲と `TrustDecision` の lookup を RED にしてから実装
- **Red-Green-Refactor**: 各レイヤーで TDD サイクルを適用し、グリーン後に `TrustDecision` の legacy 互換分岐（`maybeLegacy`）の整理を検討
- **リファクタリング**: グリーンになるたびに `globalThis.__TrustPolicyClass` / `__trustDbKernel` の global registry 結合を最小化

## 見積もり
1 pt（0.5人週、要チームでの見積もり）

## 技術的考慮事項
- 依存関係: `TrustDbKernel` / `TrustDbAdmin` / `TrustPolicy` の循環に注意。`TrustPolicy.ts` から `TrustDbAdmin` を import すると循環が生じるため、`getTrustPolicy()` の委譲は `globalThis.__trustDbKernel.getPolicy()` 経由か、lazy import（関数内 `await import('./TrustDbAdmin.js')`）で循環を回避する。既存の `gk?.getPolicy` パターンを維持しつつ fallback の `new TrustPolicy` 部分だけを削除するのが最小差分。
- テスタビリティ: `_resetTrustPolicyForTest()` / `_resetTrustDbAdminForTest()` を使って orphan 状態を再現。`TrustDecision` は constructor injection（`new TrustDecision(policy, admin, permissionManager)`）を残しつつ、デフォルト引数の eager capture を排除してテストで差し替え可能にする。
- 非機能要件: 記録ゲートは engagement event ごとに実行されるため、`isTrusted()` の lookup は同期 `getPolicy()` + 同期 `isDomainTrusted()` に留め、不要な async / storage I/O を追加しない。`initialize()` は既存通り `await admin.initialize()` で 1 回だけ実行。
- 循環対策: `TrustPolicy.ts` が `TrustDbAdmin` に依存しない形を維持するなら、`getTrustPolicy()` は `globalThis.__trustDbKernel.getPolicy()` の存在を必須とし、未初期化時は throw（例: `throw new Error('TrustDb not initialized: call getTrustDbAdmin().initialize() first')`）する。呼び出し元（`TrustDecision.isTrusted`）は `try { await admin.initialize(); }` で初期化を保証するため、throw は初期化前直呼びのバグ検出に役立つ。

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# orphan fallback の存在確認
grep -n "new TrustPolicy" src/utils/trustDb/TrustPolicy.ts
grep -n "getTrustPolicy" src/utils/trustDb/TrustPolicy.ts src/utils/trustDb/TrustDecision.ts

# TrustDecision の capture 箇所
grep -n "trustDecision\|getTrustPolicy\|getTrustDbAdmin" src/utils/trustDb/TrustDecision.ts

# Admin の Policy 共有
grep -n "getPolicy\|__trustDbKernel\|__TrustPolicyClass" src/utils/trustDb/TrustDbKernel.ts src/utils/trustDb/TrustDbAdmin.ts src/utils/trustDb/TrustPolicy.ts

# 呼び出し元の recording gate
grep -rn "isTrusted\|trustDecision" src/ --include="*.ts" | head -n 30
```

既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。特に `TrustDecision` の `maybeLegacy` 分岐（2-arg legacy signature / god object `getPolicy`/`getAdmin`）は後方互換のため残置されているが、今回の修正で stale cache を生まないことを最優先し、legacy path も admin 経由 lookup に寄せる。

### 実装手順
1. **E2E/統合テストを RED にする**: `TrustDbAdmin.initialize()` 後に `isTrusted('example.com')` が `UNVERIFIED` ではなく `TRUSTED` を返すテスト、初期化前に `isTrusted()` が orphan を cache しないテスト、tranco 更新伝播テストを先に書き失敗を確認する（Outside-In）。
2. **`TrustPolicy.ts` の fallback を削除**: `getTrustPolicy()` から `if (_policyInstance) return` と `new TrustPolicy({ save: async () => {} })` を削除し、以下のいずれかに置換する:
   ```typescript
   export function getTrustPolicy(): TrustPolicy {
     const gk = (globalThis as unknown as Record<string, unknown>).__trustDbKernel as { getPolicy?: () => TrustPolicy } | undefined;
     if (gk?.getPolicy) return gk.getPolicy();
     // Kernel 未初期化時は throw — orphan を作らない
     throw new Error('TrustDb not initialized: call getTrustDbAdmin().initialize() first');
     // または: return getTrustDbAdmin().getPolicy(); // 循環に注意（lazy import で回避）
   }
   ```
   `_policyInstance` 変数自体も削除するか、互換のため残す場合でも書き込み箇所を削除する。`_resetTrustPolicyForTest()` は no-op または削除。
3. **`TrustDecision.ts` の stale cache を排除**: `private policy: TrustPolicy` フィールドを削除し、`isTrusted()` 内で毎回 lookup する:
   ```typescript
   async isTrusted(url: string): Promise<TrustDecisionResult> {
     const domain = extractDomain(url);
     if (!domain) return { trusted: false, reason: 'invalid_domain' };
     // ...
     await this.admin.initialize();
     const policy = this.admin.getPolicy(); // または getTrustDbAdmin().getPolicy() / getTrustPolicy()
     const result = policy.isDomainTrusted(domain);
     // ...
   }
   ```
   コンストラクタの `policy = getTrustPolicy()` デフォルト引数による eager capture を削除し、`private get policy()` getter で `this.admin.getPolicy()` に委譲するか、フィールド自体を削除する。`export const trustDecision = new TrustDecision()` は維持するが、capture しないため安全になる。
4. **単体テストで委譲を検証**: `getTrustPolicy()` が `new TrustPolicy` を呼ばないこと、`TrustDecision.isTrusted()` が呼び出しごとに `getPolicy()` を呼ぶことを spy で検証し GREEN にする。
5. **リファクタリング**: `globalThis.__TrustPolicyClass` / `__trustDbKernel` の global registry が依然必要か確認し、可能なら `TrustDbAdmin` への直接 import（lazy）に置換。`src/utils/trustDb/TrustPolicy.ts:98` の `globalThis.__TrustPolicyClass = TrustPolicy` は Kernel の global-based instantiation のため残置 may be required — 削除可否は循環テストで確認。
6. **validate**: `npm run type-check` と `npm test -- src/utils/trustDb` で green を確認し、`grep -rn "new TrustPolicy" src/utils/trustDb/ --include="*.ts"` が test 以外で 0 件であることを確認。

### 落とし穴
- **循環 import**: `TrustPolicy.ts` から `import { getTrustDbAdmin } from './TrustDbAdmin.js'` をトップレベルで追加すると `TrustDbKernel → TrustPolicy → TrustDbAdmin → TrustDbKernel` の循環が再発する。`getTrustPolicy()` 内での `globalThis.__trustDbKernel.getPolicy()` 経由か、関数内での dynamic `await import()` で回避すること。
- **legacy `maybeLegacy` 分岐**: `TrustDecision` コンストラクタの `maybeLegacy.isDomainTrusted && addToWhitelist` 判定はテストの mockDb（god object）を Policy/Admin に分解する互換コード。修正後もテストがこの分岐を通る場合、分解後の `this.policy` が依然として mock の固定クロージャになるため stale ではないが、本番 path では使われないことを確認する。可能なら legacy 分岐も `admin.getPolicy()` に寄せる。
- **`_policyInstance` の残骸**: 既存テストが `_resetTrustPolicyForTest()` を呼んで orphan をリセットしている。`_policyInstance` を削除する場合、この helper を no-op にしてもテストが依存しないことを確認する。削除せず残す場合でも `getTrustPolicy()` が `_policyInstance` に書き込まないことを保証する。
- **初期化前 throw の影響範囲**: `getTrustPolicy()` を throw に変えると、初期化前に呼んでいたコード（`TrustDecision` 以外の直呼び）がクラッシュする。`grep -rn "getTrustPolicy" src/ --include="*.ts"` で呼び出し元を洗い出し、すべて `await getTrustDbAdmin().initialize()` 後に呼ぶか、`TrustDecision` 経由に置換されていることを確認する。
- **`trustDecision` singleton の再生成**: `export const trustDecision = new TrustDecision()` は module キャッシュで 1 回だけ生成される。`policy` フィールドを削除すれば singleton 自体は無害だが、テストで `trustDecision` を再利用する際に `admin` が mock に差し替わらない問題が残る。必要なら `trustDecision` を getter 関数 `getTrustDecision()` に置換するか、テストで `vi.resetModules()` を使う。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする（Happy path / Bypass blocked / Refresh / capture 排除 / 委譲）
- [ ] `src/utils/trustDb/TrustPolicy.ts` の orphan fallback（`new TrustPolicy({ save: async () => {} })`）が削除され、`grep` で fallback 生成 0 件
- [ ] `src/utils/trustDb/TrustDecision.ts` の `private policy` 固定キャッシュが削除され、呼び出しごとの admin seam lookup に置換されている
- [ ] テストカバレッジが基準を満たす（TrustDb / TrustDecision の分岐カバレッジが低下しない）
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（`dev-docs/DESIGN_SPECIFICATIONS.md` §5.5 TrustDb 節の 2 seam 記述に orphan 問題の解消を追記、必要なら ADR `2026-08-20` の循環記述を更新）
- [ ] `npm run validate` green

## 参考資料
- `src/utils/trustDb/TrustPolicy.ts:103` — `getTrustPolicy()` の fallback 生成
- `src/utils/trustDb/TrustDecision.ts:31,144` — `new TrustDecision()` の module-init capture と `export const trustDecision`
- `src/utils/trustDb/TrustDbAdmin.ts:123` — `getPolicy()` が Kernel の Policy を返す seam
- `src/utils/trustDb/TrustDbKernel.ts` — `initialize()` / `getPolicy()` / `__trustDbKernel` global registry
- ブランチ `0902a` レビュー — Critical business-logic finding（Trust bypass）
- `dev-docs/archived/pbi/2026-09-03-04-refactor-trustdb-seam-split.md` — 前段の 2 seam 分割 PBI（本 PBI はそのフォローアップ）

