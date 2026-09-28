# PBI: AI レート制限値の reader/writer 分離の修復

## ユーザーストーリー

保守者として、ダッシュボード UI で設定した AI レート制限値が実際のレート制限判定に反映されるようにしたい。なぜなら現状は書き手と読み手が別 storage 形式に分離しており、UI に設定した上限が常に無視されて既定値へフォールバックしているからだ。

## ビジネス価値

- ユーザーが設定したレート上限が実効となり、想定外の API コスト増加を防ぐ。
- 同一の reader/writer 分離バグが 2026-09-22 に 1 件だけ修復済みであるにもかかわらず残存している状態を解消し、storage 契約の不整合を揃える。
- 既存テストが実経路（writer から reader への round-trip）を踏んでいない盲点を埋め、将来の再発を検知できるテストへ置き換える。
- 検証済みの先行修正と同じ 3 段 fallback 形を再利用するため、未知の挙動を持ち込まずに修正できる。

## 優先度

- 種別: fix
- 順位: 1 / 17
- RICEスコア: 36.0（Reach=6 / Impact=3 / Confidence=100% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: UI で保存したレート上限がレート制限判定に反映される
  Given recording conditions UI が settings blob 経由で aiRateLimitMax を保存済みである
  And 保存直後のチェックが blob の値を参照できる環境である
  When レート制限チェックが最大回数を解決する
  Then blob に保存された値が採用され、既定値にフォールバックしない

Scenario: blob に値がない環境では legacy top-level と既定値の順に解決する
  Given settings blob に aiRateLimitMax が入っていないインストールである
  When レート制限チェックが最大回数を解決する
  Then legacy top-level キーがあればその値を使い、なければ既定値を返す

Scenario: 0 や負値および非有限数は有効値として扱わない
  Given blob に aiRateLimitMax が 0 または負値で保存されている
  When レート制限チェックが最大回数を解決する
  Then 0 は無制限として採用されず、既定値へフォールバックする
```

## 受け入れ基準

- [x] `getRateLimitMax` が blob → legacy top-level → SettingsRepository（動的 import）の 3 段 fallback を持ち、優先順位は blob を最優先にしている。
- [x] 有効値の判定は `typeof value === 'number' && value > 0` の現行意味論を保持し、0・負値・非有限数・数値文字列は採用しない。
- [x] `MAX_MONTHLY_TOKENS` の 0 = 無制限という意味論を `AI_RATE_LIMIT_MAX` に適用していない。
- [x] blob 経由の writer（`settingsRepository.setAll`）から reader（`getRateLimitMax`）への round-trip テストを新設している。
- [x] `src/utils/__tests__/aiUsageTracker.test.ts:14-22` の手書き StorageKeys テーブルを実型から導出する形に置き換えている。
- [x] `src/utils/__tests__/aiUsageTracker.test.ts:330,360` の `mockStorage['ai_rate_limit_max']` 直書きテストの扱いを、legacy 経路の pin として残すか更新するかを明示している。
- [x] 暗号化済みインストールで段 3 の動的 import が機能することをテストしている。
- [x] `npm run validate` が成功し、既存のビルド・テストに回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 外部からは「UI でレート上限を変更すると、その後の AI 呼び出しがその上限で止まる」という観測点を確認する。
- 新しいユーザー機能は追加しない。既存導線の結果が変わらないことを Outside-In の観測点とする。

### 統合テスト

- `settingsRepository.setAll` で blob に書いた値が `checkRateLimit` の上限解決に届くことを一続きの経路として検証する。
- 暗号化済みインストール相当の storage stub で、段 3 の repository 経路が解決されることを確認する。
- `src/utils/__tests__/aiUsageTracker.test.ts:14-22` の StorageKeys mock を実型（`src/utils/storage/types.ts:402`）から導出する形に置き換え、キーの二重定義をなくす。

### 単体テスト

- blob に値がある / legacy のみ / どちらもない / 0 / 負値 / 非有限数 の 6 系統で `getRateLimitMax` の解決順を検証する。
- 既存テスト `src/utils/__tests__/aiUsageTracker.test.ts:330,360` は top-level 直書きのため実経路を踏んでいない。writer から reader への round-trip テストを新設してその穴を埋める。
- 既定値 `DEFAULT_RATE_LIMIT_MAX`（`src/utils/storage/defaults.ts:115`）へのフォールバックが既定で有効であることを確認する。

## 実装アプローチ

- **Outside-In**: まず「UI で保存した上限が実際の判定に使われる」という外部観測点（round-trip テスト）を failing として書き、それを green にする形で reader を直す。
- **Red-Green-Refactor**: blob 読み取りが fallback しない現状を Red として再現し、3 段 fallback 導入で Green にする。最後に mock テーブルの型導出へ整理する。
- **先行修正への同形化**: `getMaxMonthlyTokens`（`src/utils/aiUsageTracker.ts:252-281`）の 2026-09-22 修復と同じ形へそろえ、storage 解決の契約を一箇所に集約する。
- **意味論の分離**: 2 つの値は fallback 段構成を共有しても、有効値判定は `MAX_MONTHLY_TOKENS`（`>= 0`）と `AI_RATE_LIMIT_MAX`（`> 0`）で分ける。
- **スコープの限定**: trustChecker alert 4 キーと feedbackQueue の同種不一致は台帳送り済みであり本 PBI の変更対象外とする。

## 見積もり

**0.5 SP**

`getRateLimitMax` 1 関数の 3 段 fallback 化と、round-trip テストの新設および mock テーブル整備が主体である。writer 側（`src/dashboard/recordingConditionsSettings.ts:222-231`）と storage 型は変更しない。

## 技術的考慮事項

- writer は `src/dashboard/recordingConditionsSettings.ts:222-231` の `settingsRepository.setAll({...})` で `StorageKeys.AI_RATE_LIMIT_MAX` を settings blob に書く。writer 側は正しく、reader だけが誤っている。
- reader は `src/utils/aiUsageTracker.ts:59-67` の `getRateLimitMax` であり、`chrome.storage.local.get(StorageKeys.AI_RATE_LIMIT_MAX)` で top-level キーのみを読む。blob 書き込みが見えないため常に `DEFAULT_RATE_LIMIT_MAX` に落ちる。
- 先行修正済みの `getMaxMonthlyTokens`（`src/utils/aiUsageTracker.ts:252-281`）が 2026-09-22 に同じ不具合を 3 段 fallback で修復済みで、コメントに経緯が記載されている。`getRateLimitMax` はその修復から漏れた。
- blob の型宣言は `src/utils/storage/types.ts:402`（`StorageKeyValues`）、既定値は `src/utils/storage/defaults.ts:115`。
- `MAX_MONTHLY_TOKENS` は 0 = unlimited だが `AI_RATE_LIMIT_MAX` は `> 0` のみ有効である。`isValid` を 2 つで共有すると 0 の扱いが壊れる。
- 段 3 の `await import('./SettingsRepository.js')` は、`chrome.storage` を stub したテスト setup が module-load 副作用を避けるために動的 import としている。静的 import へ変えると既存テストの前提が崩れる。
- 現行テスト `src/utils/__tests__/aiUsageTracker.test.ts:330,360` は `mockStorage['ai_rate_limit_max']` を直書きしており実経路を通らない。`:14-22` も StorageKeys を手書きの 3 枚目のテーブルで mock している。
- スコープ外: trustChecker alert 4 キーおよび feedbackQueue の同種不一致（採点台帳の台帳送り欄参照）。

## 実装者向け注記

### 現状コードの確認

- `src/dashboard/recordingConditionsSettings.ts:222-231` は UI 側で 8 キーをまとめて `settingsRepository.setAll` しており、`AI_RATE_LIMIT_MAX` はその中に含まれる。
- `src/utils/aiUsageTracker.ts:59-67` の `getRateLimitMax` は top-level キーのみを読み、blob 経路を持たない。`typeof value === 'number' && value > 0` の判定は現行の意図を正しく表している。
- `src/utils/aiUsageTracker.ts:252-281` の `getMaxMonthlyTokens` は 3 段 fallback の完成形であり、各段にコメントで理由が書かれている。段 3 のみ動的 import である。
- `src/utils/__tests__/aiUsageTracker.test.ts:14-22` は StorageKeys を手書きしたテーブルで mock しており、実の `src/utils/storage/types.ts:402` とは別管理になっている。
- `src/utils/__tests__/aiUsageTracker.test.ts:330,360` は `mockStorage['ai_rate_limit_max']` を直接書いているため、writer を経由しない。

### 実装手順

1. 失敗するテストを書く。blob（`settingsRepository.setAll` 経由）で `AI_RATE_LIMIT_MAX` を書き、`checkRateLimit` がその値を使うことを期待して Red を確認する。
2. `getRateLimitMax` を 3 段 fallback（blob → legacy top-level → 動的 import の repository）へ書き換える。有効値判定は `typeof value === 'number' && value > 0` を各段に適用する。
3. 0・負値・非有限数・数値文字列で既定値へフォールバックすることをテストする。`MAX_MONTHLY_TOKENS` の 0 = unlimited を持ち込まない。
4. 暗号化済みインストール相当（repository が blob を復号する）stub で段 3 が効くことをテストする。
5. `src/utils/__tests__/aiUsageTracker.test.ts:14-22` の StorageKeys mock を実型から導出する形へ置き換える。
6. `src/utils/__tests__/aiUsageTracker.test.ts:330,360` の既存テストが legacy top-level 経路の pin として意図どおりか確認し、意図不符なら更新する。
7. `npm run validate` を実行して型とテストを確認する。

### 落とし穴

- 3 段 fallback の優先順位を誤ると、legacy 値が blob の新しい値を上書きする。blob を最優先にする。
- `isValid` を `getMaxMonthlyTokens` と共有すると、`AI_RATE_LIMIT_MAX` に 0（無制限）が通ってしまう。`> 0` を保つ。
- 段 3 を静的 import に変えると、`chrome.storage` を stub したテストで module-load 副作用が発生してテストが落ちる。動的 import を維持する。
- mock の StorageKeys テーブルを手書きで残すと、実型にキーが追加されたときに再びずれる。実型からの導出へ置き換える。
- 既存の top-level 直書きテストを削除すると legacy 経路の pin を失う。legacy 経路として明示して残すか round-trip テストへ置換するかを判断する。

## 決定事項

1. writer が blob へ書き reader が top-level を読む状態になった理由は、UI 側が SettingsRepository 経由の blob 書き込みへ移行する一方で reader は legacy キーを読み続けていたためである。
2. reader が放置された理由は、2026-09-22 の `MAX_MONTHLY_TOKENS` 修復が単一キーの修正として終わり、同一 fallback を使う sibling getter へ及及しなかったためである。
3. 既存テストで検出されなかった理由は、テストが `mockStorage` へ top-level キーを直書きしており writer を経由しない経路検証になっているためである。
4. 今是正する必要が立っている理由は、ユーザーが設定した上限が一切効かず、レート制限というガードが実質的に外れたまま実害として観測されるからである。
5. `getRateLimitMax` は `getMaxMonthlyTokens` と同形の 3 段 fallback（blob → legacy top-level → SettingsRepository の動的 import）へ統一する。
6. 3 段の優先順位は blob を最優先とし、legacy は移行前の書き込みとテスト fixture との互換にのみ使う。
7. 有効値の判定は現行の `typeof value === 'number' && value > 0` を保持し、0 = 無制限は `AI_RATE_LIMIT_MAX` に適用しない。
8. writer 側（`src/dashboard/recordingConditionsSettings.ts:222-231`）と storage 型（`src/utils/storage/types.ts:402`）は変更しない。
9. trustChecker alert 4 キーと feedbackQueue の同種不一致は台帳送り済みとし、本 PBI では扱わない。

## Definition of Done

- [x] `getRateLimitMax` が 3 段 fallback を持ち、blob を最優先に解決している。
- [x] 有効値判定が `> 0` を保持し、0・負値・非有限数が採用されない。
- [x] blob 経由の writer から reader への round-trip テストが新設され、Red から Green への過程が確認できる。
- [x] legacy top-level 経路の pin が維持されている。
- [x] `src/utils/__tests__/aiUsageTracker.test.ts:14-22` の StorageKeys mock が実型から導出される形に置き換わっている。
- [x] 暗号化済みインストール相当で repository 経路が解決されることをテストしている。
- [x] `MAX_MONTHLY_TOKENS` の 0 = unlimited 意味論が `AI_RATE_LIMIT_MAX` に影響していない。
- [x] `npm run validate` が成功し、既存テストに回帰がない。
- [x] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [x] コードレビューが完了している。
