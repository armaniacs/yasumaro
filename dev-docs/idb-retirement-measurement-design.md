# IDB 去就の計測設計（プライバシー制約下）

PBI 2026-10-22-01 の受入基準3「IDB去就の計測設計(privacy制約下)が文書化され、測定なしの廃止をしない契約が明記される」に対応する設計文書。判断保留の PBI-B（`dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md` の IDB 層廃止の可否判断）の前提をここで確定させる。

## 契約: 測定なしの廃止をしない

- IDB 中間層の廃止（Option B）は、**fallback-only 到達率の計測結果が出るまで実施しない**。
- 計測が未設計・未実行・結果ゼロのいずれの状態でも、廃止の決定はしない。
- wa-sqlite sunset（Option A）はこの計測と独立して進められる（PBI 2026-09-05-32 のゲート条件に従う）。Option A の完了は Option B の go/no-go を替えない。

## 計る信号

- オフスクリーン STATUS の extras が返す `compileOptionsSource`（`'opfs-worker' | 'idb' | 'fallback'`）。実在確認済み: `src/offscreen/recordsRepo.ts` の STATUS 応答、`src/offscreen/IdbVfsBackend.ts`（`'idb'`）、`src/offscreen/opfsWorker/statusHandlers.ts`（`'opfs-worker'`）。
- fallback 経路のソース値は `fallbackMigration.ts` が組み立てる extras に現れる。診断パネルはこの extras を既に受け取っている（`sqliteStatus.ts` の pickStatusExtras 経由）。

## 計り方（ローカル集計のみ）

1. 集計はダッシュボード（診断パネル）の読み取り時にクライアント側で行う。サービスワーカー・オフスクリーンに新規の書き込み路を追加しない。
2. 保存するのは**ソース値ごとの件数のみ**（`opfs-worker` / `idb` / `fallback` の 3 値）。既存の設定キー 1 個に集計値を置く。観測窓の開始日時と合計読み取り回数を同じキーに置く。
3. 保存しないもの: `path`、`initError`、`compileOptions` の中身、ユーザー コンテンツ、タイムスタンプ単位の生ログ。初期化エラー文には環境固有の語が入るため集計対象から除外する。
4. ネットワーク送信なし。集計値は端末外に出ない（監査台帳・ログ転送にも載せない）。

## 指標と判断基準

- 指標: `fallback-only 到達率 = fallback の件数 ÷ ソース値既知の読み取り総数`。
- 観測窓: 診断パネルを開いた回を母数とする（拡張機能の通常利用ではパネルは開かれないため、母数は「保守担当者の確認回」となる。母数が小さいことは指標の説明に明記する）。
- go/no-go: fallback の件数が 0 でない限り Option B は no-go。fallback の説明（`fallbackMigration.ts` の存在理由）が残る間は IDB 廃止で fallback-only ユーザーの検索経路が消えるため。
- 結果の記録先: この文書の「計測結果」節に追記する（監視台帳は別概念なので使わない）。

## 計測結果

（未計測。実施日に日付・母数・3 値の件数・到達率を追記する。）
