# PBI: clearOldTrancoDomains()のコスト特性変化をドキュメント化する

**作成日**: 2026-08-01
**優先度**: Low
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（JSDocコメント追加のみ、実装ロジックは変更しない）

---

## 背景

直前のコードレビュー（fix-0801bブランチ、PBI-16実装分）での指摘。`src/utils/trustDb/trancoConsentManager.ts` の `clearOldTrancoDomains()` は、PBI-16の変更で `chrome.storage.local.remove()` から `saveSettings()` 経由の「空配列を設定」に実装が変わった。

```ts
static async clearOldTrancoDomains(): Promise<void> {
  const { saveSettings } = await import('../storage/settingsStore.js');
  await saveSettings({
    [this.STORAGE_KEY_TRANCO_DOMAINS]: []
  });
  logInfo('TrancoConsentManager', {}, 'Old Tranco domains cleared');
}
```

`getOldTrancoDomains()` 側は未設定時・空配列設定時のどちらも `[]` を返すため、呼び出し元から見た意味的な挙動は変わらない。ただし `saveSettings()` は内部でストレージクォータチェック・APIキー暗号化ループ・`withOptimisticLock` を伴う比較的コストの高い処理であり、単純な `chrome.storage.local.remove()` よりも実行コストが上がっている。

現時点で `clearOldTrancoDomains()` の呼び出し頻度は低い（`resetAll()` からのみ呼ばれ、これはユーザーが明示的にTranco関連設定をリセットする操作）ため実害はないが、将来この関数が高頻度に呼ばれる経路が追加された場合にコストが顕在化するリスクがある。

このリスクを次に触る開発者が見落とさないよう、コード上に明記しておく。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -rn "clearOldTrancoDomains" src/ --include="*.ts" | grep -v __tests__
```

`clearOldTrancoDomains()` の呼び出し元が現状 `resetAll()` のみであることを再確認する（呼び出し元が増えていれば、単なるドキュメント化ではなく実装見直しが必要になるため、その場合は本PBIのスコープを超える）。

## 受け入れ基準（BDD）

```gherkin
Scenario: コスト特性がJSDocに明記されている
  Given clearOldTrancoDomains()のコードを読む開発者
  When JSDocコメントを確認する
  Then chrome.storage.local.removeより高コストな処理（クォータチェック・暗号化ループ・楽観的ロック）を経由することと、高頻度呼び出しを避けるべき旨が記載されている

Scenario: 既存の呼び出し元一覧が記録されている
  Given clearOldTrancoDomains()の呼び出し頻度に関する懸念
  When 現状の呼び出し元を確認する
  Then resetAll()からのみ呼ばれる低頻度操作であることがコメントまたはPBIに記録されている
```

## 受け入れ基準
- [ ] `clearOldTrancoDomains()` のJSDocに、`saveSettings()` 経由でのコスト特性（クォータチェック・APIキー暗号化ループ・楽観的ロックを伴う）と、高頻度呼び出しを避けるべき旨を追記する
- [ ] 同様のコスト特性を持つ `saveOldTrancoDomains()` にも同じ注記を追加する（同じ`saveSettings()`経由のため）
- [ ] 既存のテストに影響がないこと（コメントのみの変更）を確認する

## テスト戦略（t_wadaスタイル）

### 単体テスト
- 不要（コメントのみの変更でロジックを変えないため）。既存の `trancoConsentManager.test.ts` がそのままパスすることの確認のみ行う

## 実装アプローチ
- ドキュメンテーションのみのPBIのため、TDDサイクルは適用しない。コメント追加後に既存テストを実行し、意図せずロジックを壊していないことを確認する

## 見積もり

1pt（JSDocコメント2箇所への追記のみ）

## 技術的考慮事項
- 依存関係: `src/utils/trustDb/trancoConsentManager.ts` のみ
- テスタビリティ: 対象外（ロジック変更なし）
- 非機能要件: 将来の保守性・コスト意識の共有が目的

## 実装手順（例）

```ts
/**
 * 旧 Tranco ドメインリストを保存（バックアップ用）
 *
 * settings オブジェクト経由で書き込む（PBI-2026-08-01-16）。従来の
 * chrome.storage.local 直接アクセスは settingsStore の移行ロジックと
 * 経路が分裂しており、migrateToSingleSettingsObject() のバックアップ退避
 * 対象から外れていた。
 *
 * 注意: saveSettings() はストレージクォータチェック・APIキー暗号化ループ・
 * withOptimisticLock を伴うコストの高い処理。高頻度呼び出しは避けること。
 */
static async saveOldTrancoDomains(domains: string[]): Promise<void> {
  ...
}

/**
 * 保存されている旧 Tranco ドメインリストを削除
 *
 * settings オブジェクト経由で削除する（PBI-2026-08-01-16）。
 *
 * 注意: chrome.storage.local.remove() より高コスト（saveSettings()経由、
 * クォータチェック・暗号化ループ・楽観的ロックを伴う）。現状は resetAll()
 * からのみ呼ばれる低頻度操作のため許容しているが、新たな高頻度呼び出し元
 * を追加する場合はコストを再検討すること。
 */
static async clearOldTrancoDomains(): Promise<void> {
  ...
}
```

## 落とし穴
- 本PBIはドキュメント化のみで実装ロジックは変えない。もし将来的に呼び出し頻度が増える設計変更が検討される場合は、別途「軽量な削除専用パス」の追加（`saveSettings`を経由しない特別扱い）を検討するPBIを別途起票すること

## Definition of Done
- [x] `saveOldTrancoDomains()` / `clearOldTrancoDomains()` のJSDocにコスト特性の注記が追加されている
- [x] 既存のテストが全てパスする（ロジック変更なしの確認）
- [x] `pbi/00-INDEX.md` が更新されている

## 実装メモ（2026-08-01完了）

呼び出し元を`grep`で確認したところ、`clearOldTrancoDomains()`は`resetAll()`からのみ、`saveOldTrancoDomains()`は現状呼び出し元なし（前提通り低頻度・未使用に近い状態）と確認できた。両メソッドのJSDocに、`saveSettings()`経由で書き込むことによるコスト特性（ストレージクォータチェック・APIキー暗号化ループ・`withOptimisticLock`を伴う）と、高頻度呼び出しを避けるべき旨を追記した。ロジック変更なし、既存32件のテストが変更なしでパス。
- コードレビュー: fix-0801bブランチ未コミット変更（PBI-13〜16実装）に対するレビュー、Suggestions #5（Correctness/将来リスク）
- 対象コード: `src/utils/trustDb/trancoConsentManager.ts`（`clearOldTrancoDomains`/`saveOldTrancoDomains`）
- 前提PBI: `dev-docs/archived/pbi/2026-08-01-16-fix-trustdb-settings-store-unification.md`（`saveSettings()`経由への変更の導入経緯）
