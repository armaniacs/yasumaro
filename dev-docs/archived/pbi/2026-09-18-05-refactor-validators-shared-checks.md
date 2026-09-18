# PBI: validators 共有検査の helper 集約（refactor）

優先度: 台帳 RICE 14.0（Reach 7 / Impact 2 / Confidence 1.0 / Effort 1pt）
backlog: [2026-09-18-00-backlog-holistic-0918.md](2026-09-18-00-backlog-holistic-0918.md)（台帳、候補 C1）
依存: なし

## ユーザーストーリー

拡張機能を保守する開発者として、メッセージ validator の共有検査を helper に集約してほしい、なぜなら現在は同一の検査が3バリデータに複製されており、許可スキームや上限の変更時に片側だけ更新される波及漏れのリスクがあるから。

## 背景（現状と課題）

`src/messaging/validators.ts` に以下の三重複がある（着手時に行番号を再確認すること）：

1. protocolVersion 検査 — `ValidVisitValidator`（115-117行目付近）と `FetchUrlValidator`（411-413行目付近）で同一文言 `protocolVersion must be a number`
2. http scheme 検査 — `FetchUrlValidator`（401-410行目付近）と `ManualRecordValidator`（447-455行目付近）で同一の `isHttpScheme` 判定 + 3文言（non-empty / must be http or https / must be valid URL）。SSOT は `utils/archiveGuards.ts` の `isHttpScheme`
3. content 上限検査 — `ValidVisitValidator`（108-110行目付近）と `ManualRecordValidator`（459-461行目付近）で同一の `VALIDATOR_LIMITS.MAX_CONTENT_LENGTH` 判定 + 文言

対応方針: モジュールローカルな `assertProtocolVersion(m, validatorName)`・`assertHttpUrl(raw, validatorName, field)`・`assertContentLength(text, validatorName, field)` を新設し、3 validator は委譲のみにする。拒否文言・field 名・評価順序は変えない。

対象外: subtype schema テーブル（PBI 2026-09-17-18 の成果）・`VALIDATOR_LIMITS` の値・`isHttpScheme` 自体の変更は行わない。

## BDD受け入れシナリオ

```gherkin
Scenario: 上限超過 content が統合前と同一文言で拒否される
  Given MAX_CONTENT_LENGTH + 1 文字の content を持つ VALID_VISIT / MANUAL_RECORD
  When 各 validator の validate を呼ぶ
  Then 両方とも統合前と byte-identical のメッセージ・field（content）で ValidationError になる

Scenario: 非 http(s) URL が両 validator で同一に拒否される
  Given javascript: スキームの URL を持つ FETCH_URL / MANUAL_RECORD
  When 各 validator の validate を呼ぶ
  Then 両方とも統合前と同一のメッセージ・field（url）で ValidationError になる
```

## 受け入れ基準

- [x] `assertProtocolVersion`・`assertHttpUrl`・`assertContentLength` が定義されている
- [x] 3 validator が helper に委譲し、直書きの重複検査が残っていない
- [x] 全拒否文言・field 名が統合前と byte-identical（parity test で pin）
- [x] 評価順序（type → payload → 個別検査）が統合前と同一
- [x] `npm run type-check` が green
- [x] messaging 配下の関連 vitest が green

## テスト戦略

- parity テスト（新規）: 現行の拒否文言・field をそのまま期待値に pin してから集約する（上限超過・空文字・不正 URL・protocolVersion 非数値の各枝）
- 既存テストの維持: `validators-limits.test.ts`・`limits.test.ts`・validator 系テストが無修正でパスすること

## 見積もり

1pt（3 helper + 3委譲 + parity test。既存テストは無修正想定）。

## 実装ガイド

- 着手時点での確認ポイント: `src/messaging/validators.ts`（ValidVisitValidator / FetchUrlValidator / ManualRecordValidator の検査順序）、`src/utils/archiveGuards.ts`（isHttpScheme SSOT）
- 文言の整形（大文字小文字・ピリオド有無）に手を入れないこと。変える場合は parity を先に pin して別差分にする
- フルテストスイートは統合側が行う。担当検証は type-check + messaging 関連 vitest に絞る
