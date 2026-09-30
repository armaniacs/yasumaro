# PBI: IndexedDB キーストアの重複実装を共通化して fail-open/fail-closed の契約を明示する

種別: refactor
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

crypto レイヤを保守する開発者として、IndexedDB の open/get/put 実装が 1 箇所に集約され、それぞれの fail-open / fail-closed 契約が型と関数名で明示された状態を目指す。なぜなら、現状はほぼ逐語的な重複実装が 2 系統あり、同じ `null` という戻り値が片方では「再生成してよい」他方では「中断せよ」という逆の意味を持つため、修正が片方だけに入る事故や契約の取り違えが起きやすいから。

## 優先度

- 順位: 13 / 13
- RICE スコア: 1.0(Reach=1 / Impact=0.5 / Confidence=1.0 / Effort=0.5)
- 根拠: 即時の動作バグではない純粋な保守性改善。ただし順位 1(匿名 KEK fail-closed 化)と順位 5(HMAC 再生可視化)がこの契約境界に触れるため、それらの後に着地すると競合が少ない。

## 証拠(レビュー由来・反証済み)

- `src/utils/crypto/secretWrappingKey.ts:60-106` と `src/utils/crypto/durableKeyStore.ts:40-87` — `indexedDB.open` / `onupgradeneeded` / transaction エラー処理が定数(DB 名・store 名)と空白のみ異なる逐語重複。`secretWrappingKey.ts:50` 自身が "mirrors durableKeyStore" と明記
- 契約の対立: `durableKeyStore.ts:21-22` — "Fails open: any IndexedDB absence or error resolves to null, and callers fall back to generating a fresh key" / `secretWrappingKey.ts:19-22` — "Fail-closed contract: ... Callers must NOT fall back to generating a fresh secret"
- 戻り値の形状は同じ(`null` / `false`)で、対立は「呼び出し側に許される次の行動」にある
- 第三のチェーン: `hmacKeyStore.ts:166-226` — session → legacy local → durable IDB の候補配列 + generate フォールバック
- `repo` 内の `indexedDB.open` はこの 2 モジュール(+hmac 経由)の 4 箇所のみ

## BDD 受け入れシナリオ

```gherkin
  Scenario: IDB 操作の実装が単一になる
    Given crypto レイヤに IndexedDB を直接扱うモジュールがある
    When ソースを走査する
    Then open/get/put の実装は共有ヘルパーに集約され、各モジュールは契約(fail-open / fail-closed)を注入して使用する

  Scenario: 契約の違いが呼び出し側から見て明示的である
    Given 共通ヘルパーを利用する 2 モジュールがある
    When ヘルパーが null を返す
    Then fail-open 側は再生成を、fail-closed 側は例外を投げるという違いが各モジュールのコードから読み取れる
```

## 受け入れ基準

- [ ] open/get/put の共通ヘルパー(DB 名・store 名・キー ID を引数に取る)を作成する
- [ ] `secretWrappingKey` / `durableKeyStore` を共通ヘルパーへ置き換える
- [ ] 契約(fail-open / fail-closed)はヘルパーの挙動としてではなく、各モジュールの呼び出し側ポリシーとして明示する(型コメントまたはラッパー関数名)
- [ ] 既存テスト(`secretEnvelope.test.ts:85` 等、override 差し替え型)との整合を保つ
- [ ] `npm run validate` が green

## テスト戦略

### 単体
- 共通ヘルパーの open/get/put 成功・失敗・欠損パスを検証する(現状、実本体が全テストで override 差し替えのため直接テストが存在しない点も埋める)

## 実装アプローチ

1. 共通ヘルパーを新設し、2 モジュールを段階的に移行する
2. 契約は「ヘルパーは素の結果を返す、ポリシーは呼び出し側」に統一する(ヘルパーに fail-open/fail-closed を埋め込まない)

## 制約

- DB 名・store 名・バージョンは現行のまま移行し、データ移行を伴わない
- 動作変更をしない(純粋なリファクタリング)

## 見積もり

1 SP

## Definition of Done

- [ ] 共通化完了と validate green
- [ ] コードレビュー完了
