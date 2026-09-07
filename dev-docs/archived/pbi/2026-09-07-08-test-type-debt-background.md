# PBI: テスト型債務返済 1/5 — background（742 errors / 87 ファイル）

> **このファイルは単独で完遂できるよう全情報を含む。** シリーズ（08〜12）の他バッチ実装者も本書の「共通実装手順」を適用すること（09〜11 はバッチ固有のスコープ差のみ記載）。

## ユーザーストーリー

yasumaroの開発者として、`src/background` 配下のテスト（録画パイプライン・Obsidian 連携・SW コアなど最重要経路のテスト群）に型チェックの生のゲートが効いてほしい。なぜなら、型債務の中には将来の実バグ（undefined アクセス・API 変更の追従漏れ）の予兆が含まれるから。

## 前提環境（実測 2026-09-07）

| 項目 | 値 |
|------|-----|
| TypeScript | 6.0.3（`module: NodeNext`・`allowImportingTsExtensions: true`） |
| vitest | 4.1.11（`globals: true` — describe/it/expect/vi は import 不要。**`vi.Mock` 等の型名前空間は vitest 4 で削除済み**） |
| ノード | CI = 24 / ローカル = 26 |
| 厳格フラグ | `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitOverride`（修復パターンに直結 — 下記参照） |
| 型チェック対象 | `testDir/tsconfig.json` の include: `src/**/__tests__`・`src/**/*.test.ts`・`src/**/*.spec.ts`・`testDir/__tests__`・`testDir/e2e/fixtures` |

### ベースラインゲートの仕様（PBI 2026-09-07-04 で導入・改変禁止）

- `npm run type-check:test` = `node scripts/check-type-baseline.mjs` — tsc を実行し**ファイル別エラー数**を `testDir/type-check-baseline.json` と比較
- **exit 0**: 全ファイルが baseline 以下
- **exit 1**: baseline 未掲載ファイルにエラー（`NEW FILE`）か、baseline 超過（`+N`）— **新規債務の導入を fail させるのが本ゲートの存在意義**
- 改善したファイルは「更新案内」を出すが **baseline は自動更新されない** — 実装者が手動で編集する（下記「baseline.json の編集規約」）
- `total` フィールドは参考値（ラッパーは `files` のみ参照）— エントリ削除時に合わせて減らしておくと誤読防止
- **`npm run type-check:test:baseline`（全量再生成）を返済中に実行してはならない** — インベントリを吹き飛ばし、未返済分の回帰検知が消失する

### baseline.json の編集規約（返済ごとに実施）

```json
{
  "total": 2601,                       ← 返済分だけ減らす（参考値）
  "files": {
    "src/background/__tests__/obsidianClient.test.ts": 89,   ← この行を丸ごと削除する
    ...
  }
}
```

## 分析: 本バッチのスコープ（実測 2026-09-07、再計測コマンドは下記）

- スコープ: **`src/background/**` の baseline エントリ** — 742 errors / 87 files（シリーズ全体 2,601 / 309 のうち 29%）
- 上位ファイル: `obsidianClient.test.ts`(89)・`service-worker.test.ts`(78)・`tabCache.test.ts`(74)・`obsidianClient-mutex.test.ts`(38)・`GeminiProvider.test.ts`(38)
- エラークラス内訳（実測）: TS7005 ×147（暗黙 any 変数）・TS2532 ×87（possibly undefined）・TS2561 ×71（オブジェクトリテラルの未知プロパティ — 下記「クラスタ固有判断」）・TS2339 ×67（mock メソッド）・TS18046 ×45（unknown）・TS2722 ×43（possibly undefined の呼び出し）・TS2345 ×42（引数不一致）・TS2559 ×33（共通プロパティなし）
- 依存なし・他バッチ（09〜11）と並行可

### バッチ固有クラスタ: `getConfirmToken` deps リテラル（TS2561 ×70・重点）

`dashboardSqliteHandlers*.test.ts` 系 4 ファイルで、テストが deps リテラルに旧キー `getConfirmToken` を渡している。実装側（`deps.ts:117-147`）は `SqliteClientBackedDeps`（現行キー: `createConfirmToken` + `verifyConfirmToken`）を定義し、`serviceWorkerDeps` の正規化シムが旧キーを実行時に変換しているため、**テストは現状グリーンで動く**。型エラーの解消はどちらか:

- (a) リテラルの型を正規化シムが受ける形に合わせる（`SqliteClientBackedDeps & { getConfirmToken?: () => Promise<string> }` 相当へ — ファクトリの引数型を確認の上）
- (b) テストを現行キーへ移行する（挙動不変を実測で確認できる場合のみ — シムが変換した結果と同値であることを `npx vitest run <file>` で確認）

実装バグの可能性（シム自体が実質 legacy である点）に気づいたら、修正せず別 PBI に切り出す。

## ビジネス価値

- 録画・Obsidian 同期・SW コアのテストに型レベルの実害検知を導入する（最重要経路が最初）
- バッチ完了は「87 ファイルがベースラインから消える」ことで客観的に検証できる

## BDD受け入れシナリオ

```gherkin
Scenario: background 配下の型エラーが 0 になる
  Given src/background 配下の baseline エントリが全て返済されている
  When npm run type-check:test:raw を実行する
  Then 出力に src/background 配下の error が 0 件である
  And 全 vitest がグリーン（実行時挙動不変）

Scenario: baseline ゲートが引き続き機能する
  Given baseline.json に src/background のエントリが無い
  When src/background のテストに型エラーを1行追加する
  Then npm run type-check:test が exit 1 になる（NEW FILE 検出）
```

## 受け入れ基準

- [ ] `src/background/**` が baseline から消滅（`npm run type-check:test:raw 2>/dev/null | grep -c "src/background"` → 0）
- [ ] baseline.json から返済済みエントリを削除（total も同値分減算）
- [ ] 型レベル修正のみで**テストの実行時挙動を変えない**（全 vitest グリーン維持・1 コミット = 1〜3 ファイル）
- [ ] 返済中に発見した**実装側の実バグ**はテスト側を曲げず別 PBI に切り出す（0 件でもメモに記録）
- [ ] `npm run validate` が exit 0

## テスト戦略

### 単体テスト
- なし（既存テストの期待値を変えない。型注釈・型アサーションのみ）

### E2Eテスト
- なし

## 共通実装手順（09〜11 もこの手順を適用する）

### 返済ループ（1 ファイル = 1 サイクル）

```bash
# 1) 現状のエラー一覧（--pretty false が grep 前提。tsc は exit 2 で正常）
npm run type-check:test:raw -- --pretty false > /tmp/tc.log 2>&1 || true
grep "src/background" /tmp/tc.log | cut -d'(' -f1 | sort | uniq -c | sort -rn | head -10

# 2) 1 ファイルのエラー詳細（行番号・メッセージ）
grep "src/background/__tests__/tabCache.test.ts" /tmp/tc.log

# 3) 修正（実コードの行内容を必ず読む — メッセージだけに釣られない）

# 4) 挙動不変の確認（テスト1本）
npx vitest run src/background/__tests__/tabCache.test.ts

# 5) lint（eslint 設定は import 順等に干渉するため修正後毎に）
npx eslint src/background/__tests__/tabCache.test.ts

# 6) baseline から当該エントリを削除（上記「編集規約」）

# 7) ゲート確認（exit 0 = ベースライン以下）
npm run type-check:test

# 8) コミット（下記「コミット規約」）
git add src/background/__tests__/tabCache.test.ts testDir/type-check-baseline.json
git commit -m "refactor(test): tabCache.test.ts の型エラー 74 件を解消"
```

### 修復パターン（実例つき — 本バッチの実エラー）

**TS7005（暗黙 any 変数 ×147）** — 実例: `obsidianClient-mutex-map.test.ts:14` `const mutex = client._globalWriteMutex;`
→ `client` の宣言に型を付けるか、`(client as unknown as { _globalWriteMutex: Mutex })._globalWriteMutex` 形式のキャスト。**プライベートメンバーへはテスト用に公開型をでっち上げない** — クラスが公開している型・`as` キャストで対応

**TS2532（possibly undefined ×87）** — 実例: `aiTestProgressNotifier.test.ts:57` `expect(mockAddLog.mock.calls[0][0]).toBe(LogType.WARN);`（`noUncheckedIndexedAccess` により `mock.calls[0]` が `| undefined`）
→ テスト意図が「1 回目の呼び出しが存在する」なら `expect(mockAddLog.mock.calls[0]?.[0]).toBe(LogType.WARN);`（undefined なら toBe が失敗する — 意図維持）か、先頭に `expect(mockAddLog.mock.calls.length).toBeGreaterThan(0);` を足す

**TS2722（possibly undefined の呼び出し ×43）** — 実例: `service-worker.test.ts:912` `const promise = serviceWorker.handleSessionLockRequest(message, {} as chrome.runtime.MessageSender, sendResponse);`
→ 呼び出し対象の実在が前提なら `serviceWorker.handleSessionLockRequest!()` か、ガード `if (!serviceWorker.handleSessionLockRequest) throw new Error(...)`

**TS2339（mock メソッド ×67）** — 実例: `obsidianClient.test.ts:547` `global.fetch.mockImplementation(...)`（fetch の標準型に mock メソッドは無い）
→ `vi.mocked(global.fetch).mockImplementation(...)`。**`vi.mocked()` は型レベルのキャストでランタイムは同一オブジェクト** — 挙動不変。`.mock.calls` / `.mockClear()` も同様に包む

**TS18046（unknown ×45）** — 実例: `dashboardSqliteHandlers-append.test.ts:381` `expect(result.success).toBe(true);`（`result` が unknown — deps ファクトリの戻り値型が不明）
→ ファクトリの戻り値に型を付ける（実装の公開型）か、`const result = ... as { success: boolean }` — `unknown` のままプロパティアクセスは不可

**TS2561（オブジェクトリテラルの未知プロパティ ×71）** — 実例: `dashboardSqliteHandlers-append.test.ts:111` `{ getConfirmToken: async () => APPEND_TOKEN }` → 上記「バッチ固有クラスタ」参照

**TS2345（引数不一致 ×42）** — 実例: `markdownJoinSafety.test.ts:86` `hasUnescapedEvilLink(appended[0])`（`string | undefined` を渡している）
→ 先行 assert で実在を確定させてから渡す（`const first = appended[0]; expect(first).toBeDefined(); expect(hasUnescapedEvilLink(first!))`）

**TS2559（共通プロパティなし ×33）** — 実例: `privacyPipeline-pii-leak.test.ts:68` `new PrivacyPipeline({ PRIVACY_MODE: string } as Settings...)`
→ 部分オブジェクトを Settings 型に渡すには完全な形が必要 — テストヘルパで既定値をマージする（`{ ...defaultSettings, PRIVACY_MODE: 'masked_cloud' }` 形式）。既存テストの helper を探して流用

### 禁止事項

- `npm run type-check:test:baseline` の実行（インベントリ消滅 — 上記参照）
- `@ts-ignore` / `@ts-expect-error` の新設（型を正す。既存 suppress の濫用も禁止）
- テストの期待値・`src/` 実装の変更（実バグ発見時は別 PBI。ただし実装修正が小さくテスト意図と完全一致する場合は実装修正 + メモ記録も可）
- スコープ外（`src/background` 以外）の修正を同コミットへ混ぜる
- コードフォーマットの全体再整形（diff 汚染）
- `git add -A` / `git add .`（対象を個別に add）

### コミット規約

- 形式: `refactor(test): <ファイル名> の型エラー N 件を解消`（日本語・Conventional Commits。挙動不変の型修正は refactor）
- 1 コミット = 1〜3 ファイル + baseline.json。単一ファイルが巨大（例: obsidianClient.test.ts 89 件）なら describe ブロック単位で分割してよい（その場合はコミットメッセージに範囲を書く）

### 実装バグ発見時の扱い

テストを型正す過程で「テストが修正してきた実装側の型エラー・undefined 経路」を発見したら:
1. 小さく（〜数行）かつテスト意図と完全に一致する実装修正 → 実装修正してコミット（`fix(impl): ...` 別コミット）+ PBI メモに記録
2. それ以外 → テスト側は `!` 等で現状維持し、別 PBI に切り出す（`pbi/00-INDEX.md` の進行中へ追加）

## 見積もり

2pt（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: 2026-09-07-04（ベースラインゲート稼働中）が前提。08〜11 は互いに独立・並行可（baseline はファイル単位なので衝突しない。ただし baseline.json の同時編集は rebase 時の軽微なコンフリクト元 — 連続実行を推奨）
- **テスタビリティ**: 1 ファイル返済のたび vitest run で挙動不変を確認（`npx vitest run --changed` でも可）
- **非機能要件**: 実行時挙動を変えないこと（`as` で誤魔化す場合は理由コメント必須 — コメント規約: 非自明な WHY のみ）

## 実装者向け注記

### 現状コードの確認
```bash
cat testDir/type-check-baseline.json | python3 -c "import json,sys; b=json.load(sys.stdin); print(b['total'], len(b['files']))"
npm run type-check:test:raw -- --pretty false 2>/dev/null | grep "src/background" | cut -d'(' -f1 | sort | uniq -c | sort -rn | head -10
```

### 落とし穴
- **カウントは実行ごとに僅かに動きうる**: baseline は「この PBI 作成時点」のスナップショット。実作業では `type-check:test:raw` の実測値を正とする（baseline に無いファイルにエラーが出たら `NEW FILE` で落ちはず — それは他バッチのファイルか、新規に生まれたエラー。 scope 判断は paths で）
- **tsc は exit 2 で正常**: エラーがある限り `type-check:test:raw` は非 0。`|| true` で吸収して出力だけ使う
- **describe/it は import 不要**（globals: true）。`import type { Mock } from 'vitest'` は型位置のみ使用可（値 `vi` は globals から）
- **`exactOptionalPropertyTypes`**: `prop: undefined` の明示代入は型エラー — 条件付きスプレッドで構築
- **E2E（playwright）は本バッチ対象外**: playwright が自身でトランスパイルする

## Definition of Done

- [ ] `src/background/**` が baseline から消滅（grep カウント 0）
- [ ] `npm run validate` exit 0
- [ ] コードレビュー完了
- [ ] 実装バグ発見の有無を PBI 完了メモに記録
