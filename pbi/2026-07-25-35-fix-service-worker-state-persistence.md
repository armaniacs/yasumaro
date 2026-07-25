# PBI: Service Workerモジュールレベル状態をchrome.storage.sessionへ永続化する

**作成日**: 2026-07-25
**優先度**: Medium
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🔴あり（Service Worker全体のライフサイクル管理に関わる変更。誤実装すると記録漏れ・二重記録・バッジ表示不整合など広範な機能不全につながる）

---

## 背景

Checking Team レビュー（2026-07-25）の Red Team Leader からの指摘。`src/background/service-worker.ts:159-213` の `CONFIRM_TOKEN`、`isCacheInitialized`、`autoSavedBadgeTabs` などの状態がモジュールレベル変数に保持されている。Service Workerは約30秒の非アクティブで終了するため、再起動時にこれらの状態が失われる。特に `isCacheInitialized` は二重初期化を防ぐフラグだが、SW再起動後はリセットされ、意図した二重初期化防止が機能しない可能性がある。

System Architectからの「モジュールレベルシングルトンの集中」指摘（PBI-36）とも関連するが、コンフリクト調整結果（レポート169-175行）では「永続化が必要な状態は `chrome.storage.session` に保存」という方針が示されている。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "CONFIRM_TOKEN\|isCacheInitialized\|autoSavedBadgeTabs" src/background/service-worker.ts
```

**このPBIは副作用が大きいため、状態ごとに永続化の要否を精査してから着手する。** 全ての変数を無条件にstorage.sessionへ移すのではなく、「再起動をまたいで意味を持つ状態」（例: `isCacheInitialized`）と「SW生存中のみ有効であればよい状態」（例: 短命なトークン）を区別する。`chrome.storage.session` はSWだけでなく拡張機能全体からアクセス可能なため、他コンポーネントとの競合可能性も確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: isCacheInitializedがSW再起動後も維持される
  Given SWが起動しキャッシュ初期化が完了し isCacheInitialized=true になっている
  When SWが30秒の非アクティブでサスペンドされ、再度起動する
  Then chrome.storage.session から isCacheInitialized を読み込み、不要な再初期化が行われない

Scenario: autoSavedBadgeTabsがSW再起動後もタブごとのバッジ状態を維持する
  Given 複数タブでバッジ表示状態が autoSavedBadgeTabs に記録されている
  When SWが再起動する
  Then chrome.storage.session から状態を復元し、バッジ表示に矛盾が生じない

Scenario: SW生存中のみ有効な短命な状態は引き続きモジュール変数のままでよい
  Given CONFIRM_TOKEN のような短命なトークン
  When 永続化の要否を精査した結果、再起動をまたぐ必要がないと判断される
  Then モジュールレベル変数のままとし、無用な永続化コストを避ける
```

## 受け入れ基準
- [ ] `service-worker.ts:159-213` の各モジュールレベル変数について、再起動をまたぐ永続化が必要かを精査し一覧化する
- [ ] 永続化が必要と判断された状態（少なくとも `isCacheInitialized`）を `chrome.storage.session` に保存し、SW起動時に復元するロジックを追加する
- [ ] 永続化不要と判断された状態はモジュール変数のままとし、その判断根拠をコメントに残す
- [ ] 既存の `service-worker.ts` テストが全てパスする
- [ ] SW再起動をシミュレートしたテスト（モジュールの再読み込み相当）で状態復元が正しく行われることを確認する

## テスト戦略（t_wadaスタイル）

### 統合テスト
- SW再起動シナリオ（テスト内でモジュールを再import、または状態リセット後に復元ロジックを呼ぶ）で `isCacheInitialized` 等が正しく復元されることを確認

### 単体テスト
- `chrome.storage.session` への書き込み・読み込みロジックが正しく動作することを確認
- 永続化対象外と判断された変数が引き続きモジュールスコープで管理されることを確認（回帰）

### E2Eテスト（最小限、可能であれば）
- 実際にSWを非アクティブにして再起動させ、記録機能が正常動作し続けることを確認（Chrome DevToolsでのSW強制終了 + 動作確認、手動）

## 実装アプローチ

1. `service-worker.ts:159-213` の全モジュールレベル変数をリストアップし、永続化要否を判定する表を作成
2. `chrome.storage.session` への保存・復元ヘルパー関数を作成
3. `isCacheInitialized` 等、永続化が必要な状態から順に移行
4. SW起動時（トップレベルまたは初期化関数内）で復元処理を呼び出す
5. テストで再起動シナリオをシミュレートし検証

## 見積もり

3pt以上（状態ごとの精査 + 実装 + SW再起動シナリオのテスト）

## 技術的考慮事項
- 依存関係: `chrome.storage.session` API（Manifest V3）
- テスタビリティ: SW再起動のシミュレーションが必要（モジュール再読み込みまたは明示的なリセット関数）
- 非機能要件: Service Workerライフサイクル対応、信頼性

## Definition of Done
- [ ] 状態ごとの永続化要否が精査・記録されている
- [ ] 必要な状態がchrome.storage.sessionに永続化されている
- [ ] SW再起動シナリオのテストが追加されパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Red Team Leader指摘、コンフリクト調整結果でSystem Architectとも合意済みの方針）
- 対象コード: `src/background/service-worker.ts:159-213`
