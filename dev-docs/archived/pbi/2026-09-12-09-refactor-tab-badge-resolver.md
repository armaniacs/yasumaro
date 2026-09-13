# PBI 2026-09-12-09 — TabBadgeResolver（タブバッジ判定の二重実装を ordered table に）

- **種別**: 🔧非機能追加（refactor）
- **優先度**: 1 位 / RICE **19.2**（R12 × I2 × C80% / E1.0人日）
- **出典**: round 10 診断 候補 01・サブエージェント探索

## 背景（なぜ）

`handleTabActivated`（tabEventHandlers.ts:46-88）と `handleTabUpdated`（:93-111）が同じ判定を 15 行ずつ再派生している（restore → normalizeUrl → privacyCache → isPrivate ? private : isDomainExcluded ? excluded : tail）。tail のみ微差。新 badge state や precedence 変更が 2 箇所同期編集になり、テストも行列を 2 回カバーする。

## スコープ

- `resolveBadge({ privacyInfo, isExcluded, isRecorded, consentOn }) → BadgeState` の純粋 module 新設（ordered table: private > excluded > recorded/recording > clear）
- `isDomainExcluded` の fail-open ラッパー（:31-37）を同 module 内へ移動
- 両 handler は I/O（cache read・`setBadge` 呼び出し）のみに痩せる。振る舞い不変

## 受け入れ基準（BDD）

### シナリオ 1: precedence が table 1 箇所で決まる（ハッピーパス）
```gherkin
Given privacyInfo.isPrivate=true かつ isExcluded=true の入力
When resolveBadge を呼ぶ
Then private が返る（table 順序どおり）
```

### シナリオ 2: activate/navigate の差分が保存される（境界）
```gherkin
Given 同一の privacy/excluded 入力
When activate 用（isRecorded=true）と navigate 用で解決する
Then activate は recorded/recording、navigate は clear を返す
```

## DoD

- [x] resolver 新設・両 handler 委譲
- [x] precedence table test + I/O 配線テスト
- [x] tabEventHandlers 関連テスト green
- [x] type-check / lint green

## 実装メモ（2026-09-12）

- `src/background/handlers/tabBadgeResolver.ts` 新設: `resolveTabBadge` + `isDomainExcluded`（fail-open ラッパーを同 module へ移動）。`isRecordingAllowed` は thunk のまま遅延評価を維持（private/excluded 経路で呼ばない従来挙動を保持）
- `exactOptionalPropertyTypes` のため interface 側に `| undefined` を明示
- 検証: tabBadgeResolver 7 tests 新設・tabEventHandlers 14 tests green・type-check green

## 見積もり

🟡中（2pt目安） / 副作用: 🟢なし（振る舞い不変のリファクタ）
