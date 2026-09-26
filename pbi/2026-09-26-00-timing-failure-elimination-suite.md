# PBI: タイミング失敗隠蔽の完全除去 — 全テスト層統合ラウンド

## ビジョン

全テスト層（Unit / Integration / E2E）から固定時間待機（sleep / retry）を完全に除去し、タイミング起因の失敗を機械的に検出・修正する仕組みを整備する。

## ユーザーストーリー

開発者として、あらゆるテストで「固定時間待つ」ことを禁止したい。そうすれば、本番コード内の待機タイミングのバグ（await 漏れ、初期化順序、競合条件）が表面化し、確実に修正される。

## 背景

**2026-09-26 までの達成**:
- Unit/Integration test (src/**/__tests__/): 40 件の sleep → condition-based に置き換え（PBI 05）✅
- ESLint rule `local/no-test-sleep`: warn → error に昇格（自動検出有効化）✅
- 知見の永続化: [[no-sleep-for-timing-failures]] / [[fake-timers-setup]] ✅

**残存する隠蔽**:
- E2E test retry: `testDir/playwright.config.ts` の `retries: 2` (extension/interaction/usability)
- E2E test code: `page.waitForTimeout` 12 件（検出対象外）
- small sleep: 6〜19ms 約 70 件（閾値外）

## 構成する PBI（全 4 件）

### 1️⃣ PBI 2026-09-26-05: Unit/Integration の固定 sleep 40 件を除去（DONE）
- ✅ 完了: statusPanel-extra(16) / recordingPipeline-full(3) / popup(3) / loader(3) / その他 7 ファイル
- ✅ ESLint rule: error に昇格
- **関連**: dev-docs/TEST_RULE.md / AGENTS.md

### 2️⃣ PBI 2026-09-26-06: E2E test の retry 隠蔽を調査・修正（新規）
- **対象**: extension/interaction/a11y/usability プロジェクト計 43 E2E テスト
- **現状**: `retries: 2` で失敗を見えなくしている
- **ゴール**: `--retries=0` でも全テスト PASS
- **手法**: `expect.poll` / `page.waitForFunction` に置き換え
- **RICE**: 2.0 / **SP**: 2
- **依存**: なし（並行可能）

### 3️⃣ PBI 2026-09-26-08: testDir を ESLint 対象に + `waitForTimeout` 検出（新規）
- **対象**: E2E の `page.waitForTimeout` 12 件
- **現状**: ESLint が testDir/ を ignore → 検出されない
- **ゴール**: 自動検出で 12 件すべて error にする
- **手法**: ESLint config に E2E ブロック追加 + 置き換え
- **RICE**: 1.0 / **SP**: 1
- **依存**: なし（並行可能）

### 4️⃣ PBI 2026-09-26-07: ESLint 閾値を 20ms → 0 に下げる + 6〜19ms 置き換え（新規）
- **対象**: 6〜19ms の sleep 約 70 件
- **現状**: 閾値外で検出されない
- **ゴール**: すべての fixed sleep を警告（0は明示的に正当化）
- **手法**: ルール修正 + 既存コード置き換え
- **RICE**: 1.5 / **SP**: 1.5
- **依存**: 06・08 完了後が推奨（衝突回避）

## 実装トポロジー

```
PBI 05: DONE ✅
  ├─ Unit/Integration: 40 件完了、error レベル有効
  └─ ルール体系化: TEST_RULE.md / AGENTS.md

PBI 06 (2SP) ┐
PBI 08 (1SP) ├─ 並行実施可能
PBI 07 (1.5SP)┘
  ├─ 06: E2E retry → condition-based
  ├─ 08: E2E code → ESLint 対象化
  └─ 07: 閾値下げ + small sleep 置き換え

統合 (全テスト層完了)
  └─ CHANGELOG / dev-docs 更新
  └─ ESLint: すべての層で error に昇格可能
```

**推奨実施順**: 06 + 08 (並行) → 07 (最後)

## ゴール状態

### ESLint による自動検出（error）
- ✅ Unit/Integration: `local/no-test-sleep` (閾値 0ms)
- ✅ E2E: `CallExpression[callee.property.name='waitForTimeout']`
- ✅ すべての層で violation = 0

### テストコード内の待機
- ✅ すべて condition-based (`drainMacrotask` / `waitForMock` / `useTimerClock` / `expect.poll`)
- ✅ 正当な 0ms sleep のみ `eslint-disable` + 理由コメント
- ✅ `--retries=0` で全テスト PASS

### ドキュメント
- ✅ TEST_RULE.md に全層統一方針を記載
- ✅ AGENTS.md に Async / Timing Failures セクション
- ✅ CHANGELOG に「テスト品質管理ラウンド」として記録

## 完了条件（統合 DoD）

- [x] PBI 05: ✅ (完了・アーカイブ済み)
- [ ] PBI 06: `npx playwright test --retries=0 --project=extension/interaction/a11y/usability` で全テスト PASS
- [ ] PBI 08: ESLint が testDir/e2e を対象に、`waitForTimeout` 12 件を検出
- [ ] PBI 07: ESLint 閾値を 0 に下げ、6〜19ms 約 70 件を置き換え
- [ ] `npm run lint` → violation 0
- [ ] `npm run test` → 全テスト PASS
- [ ] `npm run test:e2e` (または `testDir` で `npx playwright test`) → 全テスト PASS
- [ ] `npm run validate` → PASS
- [ ] CHANGELOG に「タイミング失敗隠蔽の完全除去」記載

### 既知の検証上の穴（2026-09-26 追記）

統合 DoD の「`--repeats=20` で反復実行確認」は、ESLint ルールテストについては
達成できない。RuleTester は同一モジュールインスタンス内で再入できず、
`eslint/__tests__/*.test.ts` 4 ファイルは全件失敗する（未変更の
`require-response-size-limit.test.ts` でも `--repeats=5` で 17/17 失敗することを
確認済み）。`service-worker.test.ts` の
`should rehydrate caches on first startup` も `--repeats` でのみ落ちる
（モジュール級 init 状態が反復間で漏れる。`HEAD` でも再現する既存課題）。
どちらもPBI 05 の範囲外のテスト分離の欠陥なので、07 の着手時ではなく
独立した PBI として扱う。

## 実装タイムライン

| フェーズ | PBI | 作業内容 | 期間 | SP |
|---|---|---|---|---|
| **Phase 1** | 05 | Unit/Integration sleep 除去 | 2026-09-26 | 1 ✅ |
| **Phase 2a** | 06 | E2E retry 調査・修正 | 1 sprint | 2 |
| **Phase 2b** | 08 | E2E code ESLint 対象化 | 1 sprint | 1 |
| **Phase 3** | 07 | 閾値下げ + small sleep 除去 | 1 sprint | 1.5 |
| **Phase 4** | この統合 PBI | ドキュメント / 全層検証 | 0.5 sprint | 0.5 |
| **合計** | | | 2 sprints | 5.5 SP |

## 知見・ルール化

### TEST_RULE.md に統一
1. **原則**: テストは条件の成立まで待つ。固定時間待機は禁止
2. **ESLint**: 全層で `local/no-test-sleep` + `waitForTimeout` チェック
3. **代替手段**: 層別対応表
   - Unit: `drainMacrotask()` / `waitForMock()` / `useTimerClock()`
   - E2E: `expect.poll()` / `page.waitForFunction()`
4. **検証**: `--repeats=20` / `--retries=0` で反復実行確認

### AGENTS.md に統一
- 「Async / Timing Failures」セクション に全層対応を記載
- 落ちたときの分類手順 → 修正手法の対応表

### Memory に記録
- `[[no-sleep-for-timing-failures]]`: 行動規範
- `[[fake-timers-setup]]`: 実装パターン（vitest 向け）
- `[[e2e-condition-waits]]`: E2E 向けパターン（playwright 向け、新規）

## 参考資料

- PBI 2026-09-26-05: Unit/Integration test (完了報告: 40 件 → 0)
- PBI 2026-09-26-06: E2E test retry (調査・修正)
- PBI 2026-09-26-07: ESLint 閾値下げ (small sleep 置き換え)
- PBI 2026-09-26-08: testDir ESLint 対象化 (waitForTimeout 検出)
- dev-docs/ADR/2026-09-26-test-suite-execution-time-contract.md: 背景・根拠
