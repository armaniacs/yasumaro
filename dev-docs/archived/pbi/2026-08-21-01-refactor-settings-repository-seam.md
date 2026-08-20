# PBI: SettingsRepository Seam — storage barrelの浅さを深い moduleに

## ユーザーストーリー
開発者として、`get(key)/set(key,val)/getAll()/onChange(cb)` の4メソッドだけを知れば設定の永続化が完結する深い `SettingsRepository` module がほしい、なぜなら現在の `storage.ts` barrel は38 re-export を持つ shallow な interface で、キー1つ追加するたびに32箇所の呼び出し元とテストの `chrome.storage` mock が散り、v6.7.43のAPIキー消失のような設定周りのバグが複数モジュールに跨って再発するから

## 優先度
- 順位: 01 / 05
- RICEスコア: 4800（Reach=1000 / Impact=3 / Confidence=80% / Effort=0.5）
- 根拠: Reachは全ユーザ（設定は全機能の前提）、Impactは圧倒的（v6.7.43のデータ損失級）、ConfidenceはPBI 05で `InMemoryStorageAdapter` まで実装済みで高い、Effortは1 seam+2 adaptersで0.5人月。依存なしで最初に着手すべき。

## なぜなぜ分析
- **疑問**: なぜ `storage.ts` barrel は浅いと言えるか → なぜ: 38 re-export が interface と同サイズで、削除しても複雑さは27箇所に再出現する（deletion testで shallow 確定）から
- **なぜ** 呼び出し元が `StorageKeys.FOO` を直接知る必要があるのか → なぜ: defaults/validation/encryption/migration が interface に漏れているから
- **なぜ** テストが `chrome.storage` を跨いでしか検証できないのか → なぜ: seam が `storage.ts` に無く、内部で `chrome.storage.local.get` を直接 new しているから
- **解**: `SettingsRepository` の seam に `ChromeStorageAdapter` / `InMemoryStorageAdapter` の2 adapters を置き、4メソッドの背後に defaults/validation/encryption/migration を隠蔽する

## BDD受け入れシナリオ
Scenario: 設定の読み書きが4メソッドで完結する
  Given 有効な `Settings` が永続化されている
  When 開発者が `repository.get(StorageKeys.OBSIDIAN_HOST)` を呼ぶ
  Then 正しい値が返り、`chrome.storage` の詳細を知る必要がない

Scenario: 設定変更の購読が interface 越しに検証できる
  Given `onChange` にコールバックを登録している
  When 別タブで設定が変更される
  Then コールバックが呼ばれ、変更差分が渡される

Scenario: 不正な設定値は seam 内で拒否される
  Given 不正な `port` 値を含む `Settings` を `set` しようとする
  When `repository.set` を呼ぶ
  Then validation エラーが返り、永続化されない

## 受け入れ基準
- [x] `SettingsRepository` の外部 interface が `get`/`set`/`getAll`/`onChange` の4メソッドのみである
- [x] `storage.ts` barrel の re-export が削除され、直接 import が強制される（lintで検出可能）
- [x] `InMemoryStorageAdapter` による interface 越しテストで `chrome.storage` mock が不要である
- [x] `trustDb ↔ settingsStore` 循環が `TrancoVersionTracker` 注入で解消され、ADRが更新されている

## テスト戦略
- E2E: 設定画面で値を変更し、再起動後も永続化されていること
- 統合: `SettingsRepository` + `ChromeStorageAdapter` で実際の `chrome.storage.local` への round-trip
- 単体: `InMemoryStorageAdapter` を用いた validation / encryption / migration の境界値・例外テスト。`onChange` の呼び出し順テスト

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（`dev-docs/LAYERS.md` / ADR）
- [x] `storage.ts` barrel の削除が `grep` で検証可能である
