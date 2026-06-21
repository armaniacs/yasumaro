# PBI: SQLite 閲覧履歴の保持ポリシー設定（デフォルト無制限、ユーザー設定可）

---

## 📅 更新履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-06-18 | PBI 初版作成 |

---

## ユーザーストーリー

**Yasumaro のユーザーとして**、閲覧履歴の保持期間・最大件数を自分で設定（またはデフォルトの無制限保持を選択）したい、なぜなら GDPR 等のデータ保持ポリシーが不要な場合は永続保存したいし、必要な場合は自分でコントロールしたいから。

## ビジネス価値

- デフォルト無制限により「いつの記録も消えない」という安心感を提供
- 一方で規制・容量・プライバシー上の理由で削除したいユーザーにも対応
- 現状 `purge` が全く動いていないバグを正式に「仕様変更」として解決

---

## 🔍 既実装確認（フェーズ0）

調査済み。以下の状態であることを確認済み:

| 項目 | 状態 |
|------|------|
| `purgeOldRecords(retentionDays, maxRecords)` in `sqlite.ts` | ✅ 実装済み |
| `SQLITE_PURGE` メッセージハンドラー in `offscreen.ts` | ✅ 実装済み |
| `sqliteClient.purgeOldRecords()` in `sqliteClient.ts` | ✅ 実装済み |
| `yasumaro-daily-purge` アラーム登録 in `service-worker.ts` | ✅ 登録済み（毎24時間） |
| `yasumaro-daily-purge` アラームハンドラー | ❌ **存在しない（バグ）** |
| `StorageKeys` に retention 設定キー | ❌ なし |
| ダッシュボードに retention 設定 UI | ❌ なし |
| デフォルト値 | `DEFAULT_RETENTION_DAYS=90` / `DEFAULT_MAX_RECORDS=1000`（呼ばれていない） |

**結論**: purge パイプラインは存在するが、起動口（アラームハンドラー）と設定連携が欠落している。

---

## BDD 受け入れシナリオ

```gherkin
Feature: SQLite 閲覧履歴の保持ポリシー設定

Scenario: デフォルトでは無制限保持（削除されない）
  Given ユーザーが保持ポリシーを設定していない
  When 24時間が経過して daily-purge アラームが発火する
  Then 閲覧履歴は一切削除されない
  And 1000件・90日を超えた記録も保持され続ける

Scenario: 保持期間を設定すると古い記録が削除される
  Given ユーザーがダッシュボードの設定画面で「保持期間: 30日」を設定している
  And 31日以上前の閲覧記録が存在する
  When 24時間が経過して daily-purge アラームが発火する
  Then 31日以上前の記録（スター付きを除く）が削除される
  And 30日以内の記録は保持される

Scenario: 最大件数を設定すると超過分が削除される
  Given ユーザーがダッシュボードの設定画面で「最大件数: 500件」を設定している
  And 閲覧記録が600件存在する
  When 24時間が経過して daily-purge アラームが発火する
  Then 最も古い100件（スター付きを除く）が削除される
  And スター付き記録は削除されない

Scenario: 設定を「無制限」に戻すと purge が無効化される
  Given ユーザーが以前「保持期間: 30日」を設定していた
  When ユーザーがダッシュボードで保持期間を「無制限」に変更して保存する
  Then 以降の daily-purge では記録が削除されない

Scenario: 設定 UI で無効な値を入力した場合
  Given ユーザーがダッシュボードの保持期間入力欄に「0」または負の値を入力する
  When 保存ボタンを押す
  Then バリデーションエラーが表示される
  And 設定は保存されない
```

---

## 受け入れ基準

- [ ] `StorageKeys` に `SQLITE_RETENTION_DAYS` / `SQLITE_MAX_RECORDS` を追加（型: `number | null`）
- [ ] デフォルト値は `null`（無制限・削除しない）
- [ ] `service-worker.ts` の `onAlarm` リスナーに `yasumaro-daily-purge` ハンドラーを追加
  - 設定値が `null` の場合は purge をスキップ
  - 設定値がある場合は `sqliteClient.purgeOldRecords(days, max)` を呼ぶ
- [ ] ダッシュボードの設定パネルに保持ポリシー UI を追加
  - 保持期間: セレクトボックス（無制限 / 30日 / 90日 / 180日 / 365日）または数値入力
  - 最大件数: セレクトボックス（無制限 / 500 / 1000 / 5000）または数値入力
  - 0 以下・非数値の入力を弾くバリデーション
- [ ] `PRIVACY.md` / `public/PRIVACY.md` の保持ポリシー記述を「デフォルト無制限。設定で変更可能」に修正
- [ ] スター付き記録は保持期間・最大件数にかかわらず削除されない（既存仕様の維持）

---

## テスト戦略（t_wada スタイル）

### E2E テスト（手動確認）

- ダッシュボードで保持期間を設定 → 24時間後または手動 purge トリガー → 古い記録が消えることを確認
- 「無制限」設定のまま → 記録が消えないことを確認

### 統合テスト

- `service-worker.ts` の alarm ハンドラーが `purgeOldRecords` を正しいパラメータで呼ぶこと
- `null` 設定時は `purgeOldRecords` が呼ばれないこと
- `getSettings()` 経由で `SQLITE_RETENTION_DAYS` / `SQLITE_MAX_RECORDS` が正しく読めること

### 単体テスト

- `retentionDays=null` のとき purge ロジックをスキップする
- `retentionDays=30` のとき 30日前の cutoff が正しく計算される
- `maxRecords=500` かつ 600件のとき 100件が削除対象になる（スター付きを除く）
- 設定 UI のバリデーション: 0 / 負数 / 非数値 → エラー
- 設定 UI のバリデーション: 正の整数 → 保存成功

---

## 実装アプローチ

**Outside-In**: 統合テスト（アラームハンドラー → `purgeOldRecords` 呼び出し）を先に書いて RED を確認してから実装する。

### 実装手順

1. **`src/utils/storage/types.ts`** — `StorageKeys` に追加:
   ```typescript
   SQLITE_RETENTION_DAYS = 'sqlite_retention_days',
   SQLITE_MAX_RECORDS = 'sqlite_max_records',
   ```

2. **`src/utils/storage/defaults.ts`** — デフォルト値追加:
   ```typescript
   [StorageKeys.SQLITE_RETENTION_DAYS]: null,
   [StorageKeys.SQLITE_MAX_RECORDS]: null,
   ```
   型定義（`types.ts` の `Settings`）に `number | null` で追加。

3. **`src/background/service-worker.ts`** — アラームハンドラー追加:
   ```typescript
   chrome.alarms.onAlarm.addListener(async (alarm) => {
     if (alarm.name === 'yasumaro-daily-purge') {
       const settings = await getSettings();
       const days = settings[StorageKeys.SQLITE_RETENTION_DAYS] ?? null;
       const max  = settings[StorageKeys.SQLITE_MAX_RECORDS]    ?? null;
       if (days !== null || max !== null) {
         await sqliteClientInstance.purgeOldRecords(days ?? undefined, max ?? undefined);
       }
     }
   });
   ```

4. **`src/dashboard/dashboard.ts` + `entrypoints/options/index.html`** — UI 追加:
   - General パネルまたは SQLite History パネルの末尾に追加
   - セレクト形式推奨（数値入力は UX が悪い）
   - i18n 対応必須（`data-i18n` 属性）

5. **`docs/PRIVACY.md` / `public/PRIVACY.md`** — 保持ポリシー記述修正

### 落とし穴

- `chrome.alarms.onAlarm` のリスナーは Service Worker 再起動後も登録が必要。`chrome.runtime.onInstalled` や `chrome.runtime.onStartup` 内で確実に登録すること（`service-worker.ts:83` 付近の初期化ブロックに追加する）
- `yasumaro-daily-purge` アラームは `onInstalled` で一度だけ `create` される。リスナーは毎回 SW 起動時に登録する必要がある（既存の `sessionAlarmsManager` パターンに準拠）
- `DEFAULT_RETENTION_DAYS = 90` / `DEFAULT_MAX_RECORDS = 1000` は `sqlite.ts` に残るが、**呼び出し側で `undefined` を渡すと使われてしまう**。`null` 判定を呼び出し側（service-worker）で行い、`null` のときは `purgeOldRecords` 自体を呼ばないこと
- ダッシュボード UI の `data-i18n` キーを `_locales/{en,ja}/messages.json` に追加すること

---

## 見積もり

**3 ストーリーポイント**

- StorageKeys + defaults: 0.5 SP
- alarm ハンドラー + テスト: 1 SP
- ダッシュボード UI + i18n: 1 SP
- PRIVACY.md 修正: 0.5 SP

---

## Definition of Done

- [ ] 全 BDD シナリオが自動テスト（統合 or 単体）として実装されパスする
- [ ] `null`（無制限）がデフォルトであることをテストで保証
- [ ] ダッシュボードで設定を変更 → 保存 → リロード後も値が保持される
- [ ] スター付き記録が purge 対象外であることを単体テストで保証
- [ ] `_locales/en/messages.json` / `_locales/ja/messages.json` に UI 文言追加
- [ ] `PRIVACY.md` / `public/PRIVACY.md` の保持ポリシー記述を更新
- [ ] コードレビュー完了
