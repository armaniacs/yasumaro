# PBI 2026-09-12-18 — Visit-report の commit 権を success-only に（transient 失敗で訪問が失われる実バグ）

- **種別**: 🔧非機能追加（fix・実バグ修正）
- **優先度**: 2 位 / RICE **10.7**（R10 × I2 × C80% / E1.5人日）
- **出典**: round 11 診断 候補 18・サブエージェント探索 + 直接検証

## 背景（なぜ）

`visitReporter.ts:134` が送信前に `pageState.isValidVisitReported = true` を立てる（楽観コミット）。`visitGate.isReportable`（:23）は flag が true だと以後 false を返すため、SW 忙碌・sendMessage reject・timeout のような transient 送信失敗でその訪問は永久に記録されない（catch :196-204 は flag を戻さず、:199 は timer 停止のみ）。flag を commit するルール（who/when）が module の interface に現れておらず、PageState が生データを持ち reporter が楽観書き、kernel が確定値として読む三役分断。

## スコープ

- commit ルールを reporter 内に集約: ローカル `attempting` マーカーで二重送信を防ぎ、`response.success` 時（または terminal 拒否 `DOMAIN_BLOCKED` / 非確認 `PRIVATE_PAGE_DETECTED`）のみ flag を立てる
- transport throw では flag を false のまま 1 回の bounded retry を既存 Scheduler adapter（contentKernel の IdleScheduler 系）で schedule
- `checkVisitConditions` / visitGate は不変

## 受け入れ基準（BDD）

### シナリオ 1: transient 失敗後に再送可能（ハッピーパス）
```gherkin
Given sender が 1 回目に reject する
When report() を 2 回呼ぶ
Then 1 回目で flag は false のまま、2 回目の送信が行われる
```

### シナリオ 2: terminal 拒否では flag が立つ（境界）
```gherkin
Given 応答が DOMAIN_BLOCKED / 非確認 PRIVATE_PAGE_DETECTED
When report() が完了する
Then flag は true になり再送しない
```

## DoD

- [ ] commit ルール集約 + bounded retry
- [ ] 失敗/成功/terminal の unit test 新設（timer/DOM 不要）
- [ ] content 関連テスト green
- [ ] type-check / lint green

## 見積もり

🟡中（2pt目安） / 副作用: 🟡軽微（transient 失敗時の再送が 1 回発生する = 訪問ロストの解消）
