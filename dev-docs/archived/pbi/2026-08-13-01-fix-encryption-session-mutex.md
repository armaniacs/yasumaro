# PBI: encryptionSessionのsecret復元処理を排他制御し、暗号化データの永久損失を防ぐ

## ユーザーストーリー
Yasumaro拡張機能のユーザーとして、拡張機能アップデート後もObsidian/AIプロバイダのAPIキーが引き続き正しく復号できてほしい、なぜなら暗号化キーの意図しない再生成によってAPIキーが読めなくなると、設定の再入力を強いられ、拡張機能の信頼性が損なわれるから。

## ビジネス価値
アップデート直後の一過性の競合によって暗号化データが永久に失われる事故を防ぐ。実際に2026-08-12にv6.7.42アップデート後のAPIキー消失インシデントが発生しており（`encryptionSession.ts:149-150`のコメントに記録あり）、再発防止は既知の障害対応そのものである。測定方法: リリース後のサポート問い合わせで「APIキーが消えた」報告が発生しないこと。

## 背景・根本原因（なぜなぜ分析より）
`src/utils/storage/encryptionSession.ts` の `getOrCreateEncryptionKey()` は、session→local復元処理を「`chrome.storage.session.get` → `chrome.storage.local.set` → `chrome.storage.session.remove`」の3ステップで実行するが、この3ステップはアトミックではなく排他制御もない。

Service Workerはステートレス・イベント駆動であり、`getSettings()`経由でこの関数が複数のメッセージハンドラ（messageHandlers.ts、lifecycleHandlers.ts、dashboardSqliteHandlers.ts等）から独立に並行呼び出しされうる。関数冒頭にメモリキャッシュ（`cachedEncryptionKey`）があるため、通常運用中はキャッシュヒットで競合しないが、**拡張機能アップデート直後でService Workerが再起動しキャッシュが空の状態**（＝この関数が「今世代で初めて呼ばれる」状態）で複数リクエストがほぼ同時に到着すると、以下が起きる：

1. 呼び出しA・Bともに`cachedEncryptionKey`なし、`secret`（local）なし、`saltBase64`ありという同一スナップショットを読む
2. Aが`session.get`→`local.set`→`session.remove`を完了する
3. Bが（自分のスナップショットに基づき）`session.get`を実行するが、既にAが`remove`済みのため空を引く
4. Bは`!saltBase64 || !secret`の条件で「初回起動」と誤判定し、新規ランダムsecretを生成して`local.set`でAの書き込みを上書きする
5. 既存の暗号化済みAPIキーは旧secretで暗号化されているため、新secretでは復号不能になる

根本原因は、一度きりの移行処理として書かれた関数が実際には並行呼び出しされうる構造になっているにもかかわらず、それを守る排他制御が存在せず、かつ並行処理を検証するテスト基盤（意図的な遅延注入の仕組み）も整備されていないこと。

## 修正方針
既存の `src/utils/Mutex.ts` の `Mutex` クラスを使い、`getOrCreateEncryptionKey()` のsession→local復元処理を含む一連の読み取り・生成・書き込み処理を排他制御する。同一プロセス内での並行呼び出しは直列化され、後発の呼び出しは先発の完了（`local`への書き込み・`session`のクリーンアップ）を待ってから`chrome.storage.local`を読み直すため、誤った「初回起動」判定を防げる。

## スコープ
- 対象: `src/utils/storage/encryptionSession.ts` の `getOrCreateEncryptionKey()` のみ
- 対象外: 移行処理自体をService Worker起動時の一回限りの初期化フックに分離する設計変更（将来検討、今回はやらない）
- 対象外: `Mutex` クラス自体の変更（既存実装をそのまま利用する）

## BDD受け入れシナリオ

```gherkin
Scenario: アップデート直後の並行呼び出しでもsecretが一意に確定する
  Given chrome.storage.local に ENCRYPTION_SALT のみ存在し ENCRYPTION_SECRET が存在しない
  And chrome.storage.session に旧バージョンから引き継がれた ENCRYPTION_SECRET が存在する
  When getOrCreateEncryptionKey() をほぼ同時に2回呼び出す
  Then 両方の呼び出しが同一の CryptoKey（同一のsecretから導出されたキー）を返す
  And chrome.storage.local.set で新規ランダムsecretが生成されることは一度も起きない
  And chrome.storage.session.remove は一度だけ呼ばれる

Scenario: 通常時（session/local双方に既存secretがある）は排他制御による回帰がない
  Given chrome.storage.local に ENCRYPTION_SALT と ENCRYPTION_SECRET が既に存在する
  When getOrCreateEncryptionKey() を呼び出す
  Then chrome.storage.session へのアクセスは発生しない
  And 既存のsecretから導出されたキーがそのまま返る
```

## 受け入れ基準
- [ ] `getOrCreateEncryptionKey()` の実処理（cachedEncryptionKeyがない場合の本体）が `Mutex` で排他制御されている
- [ ] 意図的にタイミングをずらせるテストヘルパー（`chrome.storage.session`/`local`のモックに遅延注入できる仕組み）を追加する
- [ ] 上記2シナリオが自動テストとして実装されパスする
- [ ] 既存の正常系（マスターパスワード有効時、session未存在時の新規生成、local既存時のスキップ、キャッシュヒット時）のテストが壊れない
- [ ] Mutexのタイムアウト（デフォルト30秒）・キュー上限（デフォルト50）の値を変更する必要がないことを確認する（想定される同時呼び出し数はメッセージハンドラ由来の少数であるため）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（Service Worker内部の排他制御であり、ブラウザ操作を伴うE2Eでは再現性が低いため統合テストで代替）

### 統合テスト
- `getOrCreateEncryptionKey()` を2つ同時に呼び出し、両方の戻り値（CryptoKeyから導出した暗号化結果の一致で間接検証）が一致することを検証する
- 遅延モックで「Aのsession.remove完了後、Bのsession.get開始」というレース窓を意図的に作り、Bが新規生成に走らないことを検証する

### 単体テスト
- Mutexの`acquire`/`release`が正しく呼ばれているか（Mutexインスタンスをモックしてスパイで検証）
- 排他制御区間の前後で`cachedEncryptionKey`が正しくセットされること
- 既存の正常系分岐（マスターパスワード有効/無効、session復元あり/なし、初回生成）がそれぞれ従来通り動作すること

## 実装アプローチ
- **Outside-In**: 統合テスト（並行呼び出しシナリオ）から書き始め、失敗を確認してから実装する
- **Red-Green-Refactor**: Mutex導入前に失敗するテストを書き、Mutex適用でグリーンにする
- **リファクタリング**: グリーン後、排他制御区間の境界（acquire/releaseの位置）が最小限かを見直す

## 見積もり
2pt 🟡（Mutex自体は既存流用だが、意図的な遅延注入テストヘルパーの新規作成が必要なため）

## 技術的考慮事項
- 依存関係: なし（既存の`src/utils/Mutex.ts`をそのまま利用）
- テスタビリティ: `chrome.storage.session`/`local`のモックに`setTimeout`ベースの遅延注入機構を追加する必要がある。既存モックが即時解決Promiseのため、この点が唯一の新規実装コスト
- 非機能要件: Mutexのロック区間はストレージI/O待ちを含むため、通常時（キャッシュヒット時）のレイテンシには影響しない。非キャッシュ時のみ直列化されるが、これは元々ネットワークではなくchrome.storage呼び出しのみで数msオーダーのため実用上問題にならない

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -rn "getOrCreateEncryptionKey" src/
grep -rn "class Mutex" src/utils/Mutex.ts
```
確認済み: `getOrCreateEncryptionKey`は`src/utils/storage/encryptionSession.ts:93-191`に実装されており、Mutexは未適用。`Mutex`クラスは`src/utils/Mutex.ts`に汎用実装として存在し、既に`ObsidianClient`等で使用実績がある（`src/background/__tests__/obsidianClient-mutex.test.ts`参照）。

### 実装手順
1. `encryptionSession.ts`にモジュールスコープの `const encryptionKeyMutex = new Mutex();` を追加する
2. `getOrCreateEncryptionKey()`内、`cachedEncryptionKey`のキャッシュヒット早期returnより後、実際のstorage読み取り（111行目以降）の前後を`try { await encryptionKeyMutex.acquire(); ... } finally { encryptionKeyMutex.release(); }`で囲む
3. ロック取得後、再度`cachedEncryptionKey`をチェックする（ロック待ち中に別の呼び出しが完了していれば、そのキャッシュ済みキーをそのまま返す。ダブルチェックロッキングパターン）
4. テストヘルパーとして、`jest.setup.ts`または新規ファイルにchrome.storage.session/localのget/set/removeへ`delayMs`パラメータを注入できるモックファクトリを追加する
5. 並行呼び出しシナリオのテストを`src/utils/storage/__tests__/`配下（既存のencryptionSession関連テストファイルを探して追記、なければ新規作成）に追加する

### 落とし穴
- Mutexの`acquire()`はキュー満杯時に例外を投げる（`maxQueueSize`デフォルト50）。通常運用でこの上限に達することは想定しにくいが、テストで大量の並行呼び出しを行う場合は上限に注意する
- ロック取得後のダブルチェック（手順3）を忘れると、Mutexで直列化しても後続の呼び出しが無駄にstorageを再読み込みしてしまう（バグではないが冗長）
- `chrome.storage.session`が存在しない環境（テスト環境や一部のChromeバージョン）を考慮した既存の`chrome.storage.session &&`ガード（160行目）はそのまま維持すること
- 遅延注入テストヘルパーは実装の`await`の粒度に依存する。既存コードの`session.get`→`local.set`→`session.remove`の間に`await`があることを利用して、モック側で各呼び出しの解決タイミングを制御する

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate`（型チェック+テスト）がグリーン
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後、ロック区間の妥当性を見直し済み）
- [ ] `pbi/00-INDEX.md`に本PBIの行を追加
