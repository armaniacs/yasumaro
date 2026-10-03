# PBI: recoveryClaimStore の同一ミリ秒同一オーナー再取得をガードする

## ユーザーストーリー

録画復旧の保守担当者として、`claimRecoveryOwner` が同一オーナー・同一ミリ秒の 2 連続取得で 2 回 true を返さない（復旧実行が重複して開始しない）ことを期待する。

## 優先度

- 順位: 14 / 15
- RICE: 0.8（R=1 / I=0.5 / C=0.8 / Effort=0.5）
- 根拠: 成立条件が 1ms 窓 + 真の並行取得に限られ、影響は復旧レコードの重複（データ損失ではない）。実行時再現なしで配線と比較のコミット由来の確認済み（C=0.8）。

## 背景（file:line 付き現状）

- `src/utils/recoveryClaimStore.ts:95` — `claimRecoveryOwner` は `mine?.owner === owner && mine.claimedAt === at` で成功判定する。同一オーナー X が同一ミリ秒 `at = T` で 2 回呼ぶと:
  - 1 回目: `:89` `isFresh` 不成立 → `:92` write → `:95` true
  - 2 回目: `:89` fresh → `:90` no-op で claims 保持 → `:94` `written[url]` は X/T → `:95` true
  - つまり 2 連続取得が両方 true を返す。
- `at` は `:82` `const at = now()` で呼出毎に取得するが、CAS conflict retry では updateFn のみが再実行され `at` は再利用される（`src/utils/storage/storageTransaction.ts:240` の re-invocation 契約）。
- 異なるオーナー・異なるミリ秒 → false（正しい）。fresh 判定は `:89` `isFresh`（TTL 内）に依存。
- 由来: `mine.claimedAt === at` 比較は cf7d8629 で導入（ベース以前から存在）。de70c8d3 は `now` → `at` のリネームと expired sweep 追加のみで挙動不変。
- 影響: 複数の復旧入口（popup pendingPages、sqliteHistory panel、notification、offline queue）が同時刻に同一 URL を同一オーナー種別で取得した場合、復旧実行が重複し復旧レコードが重複する。データ損失ではない。

## BDD受け入れシナリオ

### Scenario 1: 同一オーナー・同一ミリ秒の 2 連続取得は 2 回 true を返さない

```gherkin
Given 時計が固定され T を返す
When 同一 URL・同一オーナー 'offline-queue' で claimRecoveryOwner を 2 回連続で呼ぶ
Then 1 回目は true を返す
And 2 回目は false または「既に自分が保持している」ことを区別できる結果を返す
And 復旧実行は 1 回だけ開始される
```

### Scenario 2: 異なるオーナーの同時刻取得は false のまま

```gherkin
Given URL U に 'offline-queue' が T で claim 済みである
When 同一ミリ秒内でオーナー 'manual' が claimRecoveryOwner(U, 'manual') を呼ぶ
Then false を返し claim は書き換わらない
```

### Scenario 3: TTL 経過後の再取得は true（現行契約を維持）

```gherkin
Given URL U に TTL より古い claim がある
When claimRecoveryOwner が呼ばれる
Then true を返し claim を引き継ぐ
```

## 受け入れ基準

- [ ] 1. 同一オーナー・同一ミリ秒の再取得で true が重複しない: `src/utils/recoveryClaimStore.ts:95` の判定に一意な token（owner + モトニック counter または claim 発行毎の uuid）を導入するか、1ms 窓での重複 true を仕様として明示しテストで固定する。どちらを選ぶかは復旧入口の重複実行の許容度で決定する。
- [ ] 2. fresh claim の no-op（`:89-90`）、expired take-over、異オーナー失敗の現行契約は不変。
- [ ] 3. CAS conflict retry（`storageTransaction.ts:240` の re-invocation）で判定が壊れない: updater は純粋に保たれ（`:83-86` の契約）、retry 後も正しい成功判定を返す。
- [ ] 4. 対象は `src/utils/recoveryClaimStore.ts` とそのテストに限定し、呼び出し側（offline queue / popup / dashboard / notification）の変更を不要な形にする。

## テスト戦略

- 単体: 注入時計（`options.now`、`:73`）で T 固定の 2 連続取得を駆動し、2 回目の結果を assert。TTL 経過・異オーナー・release 後の再取得も回帰確認。
- 競合経路: `withOptimisticLock` の conflict retry を mock で誘発し、retry 後の判定が正しいことを assert。
- `npx vitest run <file> --repeats=20` で全 run green。

## 見積もり

2 SP（Effort 0.5）

## Definition of Done

- [ ] BDD 3 シナリオがテストとして実装され green
- [ ] 同一ミリ秒重複取得の挙動が決定され（token 導入 or 仕様明示）、テストで固定されている
- [ ] CAS retry 経路のテストが存在する
- [ ] `npm run validate` が green
- [ ] backlog（順位 14）としての完了報告が紐づく — アーカイブ/台帳更新は別ステップ
