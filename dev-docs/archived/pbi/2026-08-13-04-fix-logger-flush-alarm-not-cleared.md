# PBI: ロガーのフラッシュアラームが解除されない機能退行を修正する

## ユーザーストーリー
拡張機能の開発者・保守担当者として、ログバッファがフラッシュされた後は不要なアラームが残らないでほしい、なぜならアラームが残り続けると1分ごとに無駄な空フラッシュが発生し、将来アラームハンドラに副作用のある処理が追加された際に意図しない頻度で実行されるリスクがあるから。

## ビジネス価値
直接のユーザー影響は小さい（空フラッシュの無駄なCPU消費のみ）が、モジュール分割リファクタで発生した機能退行を修正し、「APIリソースを作成したら対になる解放処理を保証する」という設計原則をコードとテストの両方に固定する。将来のロガー拡張時に同じ見落としが再発することを防ぐ。

## 背景・根本原因（なぜなぜ分析より）
ロガーのモジュール分割リファクタ（コミット`264c4394`、`logger.ts`を`logger/*.ts`へ分割）以前は、`chrome.alarms.clear(LOGGER_ALARM_NAME)`を呼ぶ`clearScheduledFlush()`相当の関数が存在し、フラッシュ成功後（`flushLogs()`成功時）と`clearLogs()`実行時に呼ばれていた。分割後の`src/utils/logger/flushScheduler.ts`（`LogFlushScheduler`インターフェース、`ChromeAlarmFlushScheduler`実装）には`schedule()`（アラーム作成）のみが移植され、対になる`clear()`（アラーム解除）が移植されなかった。

結果として`src/utils/logger/core.ts`の`persistPending()`（フラッシュ成功時）・`clearLogs()`のいずれもアラームを解除しない。バッファが`BATCH_FLUSH_SIZE`到達で先にフラッシュされても、既にスケジュール済みのアラームは1分後に発火し、`persistPending()`を無駄に再実行する（バッファが空のため実質何もしないが、無駄な処理が走る）。

根本原因は、元のコードで「アラームのスケジュール」と「アラームの解除」が離れた場所に実装されていたため、モジュール分割時にスケジュール側のみが移植され解除側が見落とされたこと。この見落としを検知する自動テスト（アラームのライフサイクル状態を検証するテスト）が存在せず、`LogFlushScheduler`インターフェースにも`schedule`と対になる`clear`が定義されていないという非対称な設計がそのまま残っている。

## 修正方針
`LogFlushScheduler`インターフェースに`clear()`メソッドを追加し、`ChromeAlarmFlushScheduler`で`chrome.alarms.clear(LOGGER_ALARM_NAME)`を、`ImmediateFlushScheduler`（テスト用フェイク）でno-op相当を実装する。`core.ts`の`persistPending()`成功時と`clearLogs()`から`scheduler.clear()`を呼ぶ。

## スコープ
- 対象: `src/utils/logger/flushScheduler.ts`（インターフェース定義・両実装）、`src/utils/logger/core.ts`（呼び出し追加）
- 対象外: `chrome.alarms`を使う他モジュール（`sessionAlarmsManager.ts`等）の横断的なライフサイクル管理仕組みの整備（将来の別課題として扱う）

## BDD受け入れシナリオ

```gherkin
Scenario: バッファフラッシュ成功後はスケジュール済みアラームが解除される
  Given ログが複数件addLogされ、BATCH_FLUSH_SIZEに到達する前にアラームがスケジュールされている
  When BATCH_FLUSH_SIZEに到達し persistPending が実行され成功する
  Then chrome.alarms.clear が LOGGER_ALARM_NAME を引数に呼ばれる
  And その後アラームが発火しても追加のストレージ書き込みは発生しない（バッファが空のため）

Scenario: clearLogs実行時もアラームが解除される
  Given アラームがスケジュールされた状態でログがバッファに存在する
  When clearLogs() を呼び出す
  Then バッファとストレージがクリアされる
  And chrome.alarms.clear が LOGGER_ALARM_NAME を引数に呼ばれる
```

## 受け入れ基準
- [ ] `LogFlushScheduler`インターフェースに`clear(): void`が追加されている
- [ ] `ChromeAlarmFlushScheduler.clear()`が`chrome.alarms.clear(LOGGER_ALARM_NAME)`を呼ぶ
- [ ] `ImmediateFlushScheduler.clear()`が実装されている（no-opで可、インターフェース契約を満たす）
- [ ] `persistPending()`のフラッシュ成功パスから`scheduler.clear()`が呼ばれる
- [ ] `clearLogs()`から`scheduler.clear()`が呼ばれる
- [ ] 上記2シナリオが自動テストとして実装されパスする
- [ ] 既存のロガー関連テスト（`logger/__tests__/`配下）が壊れない

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（Service Worker内部のアラーム管理でありE2E環境での再現コストが高いため統合テストで代替）

### 統合テスト
- `ChromeAlarmFlushScheduler`の`chrome.alarms.clear`スパイを使い、`persistPending`成功後・`clearLogs`実行後にそれぞれ`clear`が正しい引数で呼ばれることを検証する

### 単体テスト
- `LogFlushScheduler`インターフェースを満たす各実装（`ChromeAlarmFlushScheduler`, `ImmediateFlushScheduler`）が`clear()`メソッドを持ち、呼び出しても例外を投げないこと
- `isFlushing`ガードによる早期return時（バッファが空の場合）は`clear()`が呼ばれない、または呼ばれても副作用がないことを確認する（実装判断: 空フラッシュ時にも呼んでおくのが安全でシンプル）

## 実装アプローチ
- **Outside-In**: `chrome.alarms.clear`が呼ばれることを検証する統合テストから書き始め、失敗を確認してから実装する
- **Red-Green-Refactor**: `clear()`未実装の状態でテストが失敗することを確認 → インターフェース・実装・呼び出し追加でグリーンにする
- **リファクタリング**: グリーン後、`schedule()`と`clear()`の対称性（両方が同じアラーム名を扱うこと）をコードレビューで確認する

## 見積もり
1pt 🟢（旧実装の再移植であり、新規設計判断はほぼ不要）

## 技術的考慮事項
- 依存関係: なし（既存モジュール内で完結）
- テスタビリティ: `chrome.alarms.clear`は既存のchrome APIモック基盤で容易にスパイ可能
- 非機能要件: なし（機能退行の復元であり性能への影響はない）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "clearScheduledFlush\|chrome.alarms.clear" src/utils/logger/*.ts
git show v6.7.30:src/utils/logger.ts | grep -n "clearScheduledFlush\|chrome.alarms.clear" -A5 -B5
```
確認済み: 現在の`src/utils/logger/flushScheduler.ts`には`clear`相当のメソッドが存在しない（`schedule()`のみ、4-8行目のインターフェース定義、37-40行目の実装）。`src/utils/logger/core.ts`の`persistPending()`（24-46行目）・`clearLogs()`（101-104行目）はいずれも`scheduler`のクリアメソッドを呼んでいない。v6.7.30タグ時点の`src/utils/logger.ts`に旧実装の`clearScheduledFlush()`が存在することは、レビューの裏取りエージェントがgit履歴で確認済み。

### 実装手順
1. `src/utils/logger/flushScheduler.ts`の`LogFlushScheduler`インターフェース（4-8行目）に`clear(): void;`を追加する
2. `ChromeAlarmFlushScheduler`に`clear(): void { if (typeof chrome === 'undefined' || !chrome.alarms) return; chrome.alarms.clear(LOGGER_ALARM_NAME); }`を追加する（`schedule()`と対称的な実装）
3. `ImmediateFlushScheduler`に`clear(): void {}`（no-op）を追加する（このフェイクはアラームを使わないため）
4. `src/utils/logger/core.ts`の`persistPending()`内、`storage.append(entries)`成功後（40行目の直後、`finally`ブロックに入る前）に`scheduler.clear()`を呼ぶ
5. `clearLogs()`（101-104行目）に`scheduler.clear()`を追加する

### 落とし穴
- `persistPending()`は`isFlushing`ガードで早期return（25行目）する経路と、`entries.length === 0`で早期return（29行目）する経路がある。`clear()`をどこに置くかで「空フラッシュでも毎回clearを呼ぶ」か「実際に何かをフラッシュした時だけ呼ぶ」かの挙動が変わる。旧実装の挙動（`git show`で確認）に合わせるか、シンプルに「フラッシュ処理が走ったら常にclearする」にするかは実装時に決めてよいが、テストでどちらの挙動を検証しているか明記すること
- `chrome.alarms.clear`はコールバック形式またはPromiseを返す場合があるが、既存の`schedule()`（`chrome.alarms.create`）が戻り値を無視しているのと同様、`clear()`も戻り値を待つ必要はない（fire-and-forgetでよい）
- `ImmediateFlushScheduler`はテストでのみ使われるため、`clear()`の実装がno-opであっても実害はない。ただしインターフェースを満たさないとTypeScriptの型チェックでエラーになる

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate`（型チェック+テスト）がグリーン
- [ ] コードレビュー完了
- [ ] リファクタリング完了（schedule/clearの対称性確認済み）
- [ ] `pbi/00-INDEX.md`に本PBIの行を追加
