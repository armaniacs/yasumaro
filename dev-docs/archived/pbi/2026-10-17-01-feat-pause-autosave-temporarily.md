# PBI: 自動保存の一時停止（プリセット時間＋自動復旧）

## ユーザーストーリー
記録を残したくない閲覧をするユーザーとして、ポップアップから自動保存をしばらく停止したい、なぜなら手動で消す手間なくプライベートな調べものを残さないようにしたいから

## 優先度
- 順位: 01 / 2
- RICEスコア: 128（Reach=80 / Impact=2 / Confidence=0.8 / Effort=1.0）
- 根拠: 記録ユーザー全員に影響し、プライバシー不安の解消効果が大きい。相手候補（セッション一括削除 RICE 32）より高く、依存関係はないため先に着手する。deep-digで二層ゲート化のため Effort 0.8→1.0 に上方修正（順位不変）

## ビジネス価値
- センシティブな調べもの（医療・金融・ギフト等）を記録せずに済み、後から消す手間と消し忘れリスクが減る
- 測定方法: 停止ボタンの利用回数、停止中の自動記録ゼロ件、復旧後の自動記録の復活率

## BDD受け入れシナリオ

```gherkin
Scenario: 30分停止して自動復旧する
  Given ポップアップを開いている
  When  停止ボタンから「30分」を選ぶ
  Then  残り時間が表示され、自動保存（スクロール/時間/スナップショット）が記録されず、手動の「今すぐ記録」は使える
  And   30分後に自動で記録可能に戻る

Scenario: 早めに再開する
  Given 停止中である
  When  「再開する」を押す
  Then  すぐに記録可能に戻り、アラーム予約が取り消される

Scenario: 再起動・SWサスペンドでも停止が続く
  Given 停止中である
  When  ブラウザを再起動する、またはService Workerがサスペンドされる
  Then  停止期限までは自動保存されない
  And   期限を過ぎたら次回起動時に記録可能に戻る
```

## 受け入れ基準
- [ ] ポップアップ上部（歯車横・画像2枚目の赤丸位置）に停止ボタンがあり、30分/1時間/3時間のプリセットを選べる
- [ ] 停止中は残り時間表示＋「再開する」ボタンがある
- [ ] 停止中は自動トリガーのみ抑止し、手動記録は成功する
- [ ] 停止中の閲覧は記録にも保留キューにも残らない
- [ ] 期限経過で自動復旧する（アラーム駆動、setTimeout禁止）
- [ ] 日英の文言（data-i18n）とキーボード操作・フォーカスがWCAG 2.1 AA相当である

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ポップアップで30分停止→自動記録が抑止→手動記録が成功→再開で自動記録が復活するユーザーシナリオ

### 統合テスト
- `chrome.alarms` 発火で `pausedUntil` がクリアされ `shouldRecord` が true に戻る
- 再起動後に `pausedUntil` が読み直され、期限前は false・期限後は true になる
- 部分失敗時（アラーム登録失敗）はエラーバッジで通知される

### 単体テスト
- 停止期限判定の境界値（期限ちょうど・1ms前・1ms後）
- プリセット時間の分→ms変換とバリデーション
- 自動/手動イベントのゲート分岐（自動=false・手動=true）

## 実装アプローチ
- **Outside-In**: E2Eテストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
5 SP（要チームでの見積もり。deep-digで二層ゲート化のため 3→5 に上方修正）

## 技術的考慮事項
- 依存関係: なし（セッション一括削除とは独立）
- 状態: `chrome.storage.local` に `recording_paused_until`（ms epoch）を保存。トップレベルキー＋設定blobの二重化に注意（`recordingTriggerManager.ts` の `readTopLevelOrBlob` パターンを踏襲）
- 復旧駆動: `chrome.alarms`（`alarmRegistry.ts` の統一テーブルに追加）。SWサスペンドで消える `setTimeout` は禁止（リポジトリ rule）
- ゲート箇所: `RecordingTriggerManager.shouldRecord()`（自動イベントのみ false、手動は true 維持）＋content側の早期抑止（deep-dig決定: プライバシー第一のためBackgroundのみは不採用。content側が paused フラグを見て自動トリガー送信自体を間引く。`decideRecordingTrigger` の純粋判定は変えず、I/O層＋content送信層の二層で抑止）
- アラーム所有権: Background経由（deep-dig決定: Popup→message→Backgroundが `alarmRegistry` テーブルに行追加して登録・復旧。Popup直接 `alarms.create` は不採用）
- 復旧精度: 概算でよい（deep-dig決定: 数十秒〜1分程度の遅れを許容し、表示は「約30分」等の概算表現に寄せる）
- UI: `src/popup/statusPanel.ts` 系に停止ボタン・残り時間・再開ボタンを追加。バッジ表示は既存 `updateStatusIcon` 方針に従う
- 非機能要件: ブラウザ再起動・SW再起動で状態復元。アラーム最小間隔（1分）の制約内で期限精度を保つ

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# 自動保存トリガーの読み方とゲート箇所
grep -rn "recording_triggers\|shouldRecord\|decideRecordingTrigger" src/background src/utils/storage | head -n 40
# ポップアップの状態パネル配線
grep -rn "initStatusPanel\|statusPanel\|recordCurrentPage" src/popup/*.ts | head -n 40
# アラーム登録の正規形（統一テーブル）
grep -n "chrome.alarms.create\|onAlarm" src/background/alarmRegistry.ts src/background/service-worker.ts
```

未実装確認済み（2026-10-17）: `recording_paused_until` 相当のキーは存在せず、一時停止の概念はない。`RECORDING_TRIGGERS` は ON/OFF のみ。

### 実装手順
1. E2E（失敗）→統合（失敗）→単体（失敗）の順にテストを書く
2. `recording_paused_until` の読み書き seam＋アラーム登録（`alarmRegistry` 行追加）を実装
3. `RecordingTriggerManager.shouldRecord` の先頭で paused 判定（自動のみ抑止）を実装
4. ポップアップ UI（停止ボタン・プリセット・残り時間・再開）を `statusPanel` 系に実装＋i18n 日英
5. 再起動復元（起動時に期限チェック＋期限切れならクリア）を確認

### 落とし穴
- `setTimeout` で復旧を実装しない（SWサスペンドで消える。必ず `chrome.alarms`）
- `chrome.alarms.create` は同名で上書きされるため、停止の延長・再開時の clear をペアで扱う
- 停止中に手動記録をブロックしないこと（自動のみ抑止が受け入れ条件）
- 残り時間表示のポーリングで SW を起こし続けない（ポップアップ表示中のみ更新）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（`pbi/00-INDEX.md` の行更新を含む）

## 深掘りセッション ― 2026-10-17

### 挑戦した仮定
| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| Backgroundの `shouldRecord` だけで全自動経路を塞げる | 高（実現可能性） | content側の先行処理・痕跡が残り得る。初回はBackgroundのみで合意したが、2段階目でプライバシー目的と矛盾すると判明 | 反転: Background＋content早期抑止の二層にする。PBI本文の技術的考慮事項を更新済み |
| Popupから直接アラーム登録できる | 高（実現可能性） | `handleAlarm` は未知名を無視し、テーブル外登録は過去の散発原因。所有権一元が教訓 | Background経由（Popup→message→registry行追加）に確定 |
| 自動のみ停止・手動は可が誤解を生まない | 高（ユーザー行動） | 停止中の残痕をユーザーは「残らない」と読む | 二層抑止＋残痕が残る場合は既知の制限として表示する（実装時に脅威モデルを明記） |
| 30分ちょうどに復旧する | 中（依存） | `chrome.alarms` は分粒度で遅延し得る | 概算でよい。表示は「約○分」に寄せる |

### 新たに発見したリスク
- content側の paused フラグ参照タイミングの競合（停止直後のin-flight送信）。実装時に送信層のチェック順序をテストで pin すること
- 残り時間表示のポーリングが SW を起こし続ける懸念は継続（ポップアップ表示中のみ更新で緩和）

### 未解決の疑問
- content側でどこまで抑止するか（送信間引きのみか、抽出自体を止めるか）は実装時の実測で最終決定する

### 決定事項
1. ゲートは二層（Background＋content早期抑止）に変更
2. アラームはBackground所有（registry行追加＋message契約）
3. 復旧時刻は概算表示
