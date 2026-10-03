# PBI: 設定リポジトリのキャッシュが書き込み後の値を読めない競合を閉じる

種別: fix (adversarial-review, RICE #3)

## ユーザーストーリー

設定を保存したユーザーとして、保存直後に読み出した設定が自分の書き込んだ値である (read-your-write) ことを期待する。保存が完了しても古い値が返る期間があれば、UI 表示と実データが一貫しなくなるから。

## 優先度

- 順位: 03/15
- RICE: 12.6 (R7 / I2 / C0.9 / E1.0)
- 根拠: 設定の読み書きは全機能から呼ばれる頻出経路のため R7。競合は読み出しと書き込みが重なる一定のタイミングでのみ顕在化するため I2。依存注記: なし (単独修正可能)。

## 背景 (evidence, verified)

- `src/utils/storage/SettingsRepository.ts:81-85` — `persistMerged` が pre/post drop。
- `:152` — `await` (`:144-147` の `applyMigrationsAndDecryptWithReEncrypt`) を挟んだ後の cached への無条件代入。
- インターリーブ: `getAll` の `port.get` (`:128`) → async window → `persistMerged` 完了 (`null,null`) → `:152` が書き込み前スナップショットに新しい timestamp 付きで代入 → TTL 1000ms (`:43`) の間そのスナップショットが供給され続ける。
- コメント `:76-78` が閉じているのは片方向の順序のみ。read-your-write 違反: `await set()` 直後の `get()` が旧値を返し得る。
- dual-drop を pin するテストが存在しない。

## スコープ (file:line)

- `src/utils/storage/SettingsRepository.ts:80-85`
- `src/utils/storage/SettingsRepository.ts:152`
- `src/utils/storage/SettingsRepository.ts:43`

## BDD 受け入れシナリオ

```gherkin
Scenario: 保存直後に自分の設定値が読める
  Given ユーザーが設定変更を保存した
  When 保存完了直後に設定を読み出す
  Then 自分が保存した値が返る

Scenario: 読み出しと保存が重なっても古い値が供給されない
  Given 設定の読み出しと保存がほぼ同時に走る
  When 保存が完了した
  Then 保存後の短い期間にも保存前の値が読み出し結果として現れない
```

## 受け入れ基準 (file-scoped)

- [ ] `src/utils/storage/SettingsRepository.ts:152` — 書き込みと重なった `getAll` の cached 代入が、書き込み後の状態を反映しない形で固定される (現在は `await` 後の無条件代入)
- [ ] `src/utils/storage/SettingsRepository.ts:81-85` — `persistMerged` の pre/post drop と `:152` の代入が競合で逆転しても、TTL (`:43`, 1000ms) 内に書き込み前スナップショットが供給されない
- [ ] `await set()` → `await get()` の read-your-write 契約がテストで pin される
- [ ] race クロージャ以外の本番ふるまい変更がない (既存 API 形状・応答は不変)

## テスト戦略

- 単体: `InMemoryStoragePort` で読み出しと書き込みのインターリーブを再現し、read-your-write を pin するテスト (実時間待ちを使わない)
- 単体: cached 代入の順序不変性 (dual-drop との組み合わせ) のテスト
- 統合: 設定保存フローでの既存テスト green 維持

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了
