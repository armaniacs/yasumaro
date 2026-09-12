# PBI 2026-09-12-12 — senderTrust を 3 tier に昇格（strict 判定の router 漏出を回収）

- **種別**: 🔧非機能追加（refactor・security-adjacent）
- **優先度**: 4 位 / RICE **12.8**（R10 × I2 × C80% / E1.25人日）
- **出典**: round 10 診断 候補 04・サブエージェント探索

## 背景（なぜ）

`MessageRouter.dispatch`（:238-246）が汎用 `checkSenderTrust` の後に第2の trust tier を inline hardcoded（VALID_VISIT/CHECK_DOMAIN は `sender.tab.id + url` + `sender.url` の http(s) を要求）。sender 政策が `senderTrust` module の外に漏出しており、page 定義の引き締めが 2 interface の同期編集になる。handler 側の `!sender.tab` guard（recordingHandlers.ts:93-96）とも重複。error 文言の順序依存（envelopePolicy.ts:5-9 の警告）も散在。

## スコープ

- `senderTrust` を 3 tier（extension-only / content-script-allowed / tab-page-only）に昇格し、tab+http(s) 規則を table の 1 行に
- router 側を単一 `checkSenderTrust` 呼び出しに縮約
- error-string 順序をテストで pin（observable rejection の順序不変を保証）
- handler 側の `!sender.tab` guard は defense-in-depth として維持（削除しない）

## 受け入れ基準（BDD）

### シナリオ 1: tab なしの VALID_VISIT は拒否される（ハッピーパス）
```gherkin
Given sender.tab がない VALID_VISIT
When dispatch する
Then 'Invalid sender' で拒否される（従来どおり）
```

### シナリオ 2: sender matrix が trust module 単体で検証できる（境界）
```gherkin
Given tab-less / extension-URL / http(s) / about:blank の sender
When checkSenderTrust の 3 tier で判定する
Then router を起動せず matrix が green になる
```

## DoD

- [x] 3 tier 昇格・router 縮約・順序 pin テスト
- [x] MessageRouter/senderTrust/envelope 関連テスト green
- [x] type-check / lint green

## 実装メモ（2026-09-12）

- `senderTrust.ts` に `tab-page-only` tier + `isTabPageSender`（tab.id+url と sender.url http(s) の両方を要求）を追加。error 文言 'Invalid sender' は router 旧文言と同一にし observable 振る舞いを維持
- router の inline strict ブロックを削除し単一 checkSenderTrust 呼び出しに。trustLevels map と getTrustLevel の型を SenderTrustLevel に widen
- coverage テストの EXPECTED_TRUST を更新（VALID_VISIT/CHECK_DOMAIN → tab-page-only）+ tier-aware な到達性ループに修正。matrix テスト 5 件新設（tab-less / extension-page / about:blank / external）
- 検証: trust+router 88 tests green・type-check green・lint 0 errors

## 見積もり

🟡中（2pt目安） / 副作用: 🟡軽微（security-adjacent のため error 文言順序の pin で回帰を防止）
