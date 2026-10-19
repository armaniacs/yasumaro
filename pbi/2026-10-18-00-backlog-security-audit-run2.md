# Backlog: security-audit run-2 の needs_validation 25件 PBI 化（2026-10-18）

security-audit run-2（source ref `d49d70a3`、リポジトリ全体、`profile: standard`）で得られた
**confirmed 0件 / needs_validation 25件 / rejected 4件** のうち、needs_validation 25件を
RICE で採点して PBI 化した。rejected 4件はソースで反証済みのため PBI 化していない。

- 監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`
  （`REPORT.md` / `NEEDS-VALIDATION.md` / `FINDINGS-DETAIL.md` / `findings.json`）
- 監査特点: OS-enforced sandbox 不在のため source-only 実行。confirmed は原理的に出ない構成で、
  25件すべて needs_validation。各 PBI の「背景（監査の出典）」に fingerprint を記載している。
- 重要: 全PBI は needs_validation であり confirmed 脆弱性ではない。着手前に各PBI の
  「ブロッカー（着手前に潰すべき検証）」を owner が解決する必要がある。

## 採点基準（全候補共通）

```
RICE = (Reach × Impact × Confidence) / Effort
Reach = 影響を受ける導入規模（相対値）/ Impact 3・2・1・0.5・0.25
Confidence = 100% / 80% / 50% / Effort = 人月
```

ハード依存は無し。同一ファイル競合の実装依存のみ PBI 内の「関連」欄に記載。

## 順位表

| NN | PBI | 種別 | RICE | SP | 難易度 | 副作用 | 依存・備考 |
|---|---|---|---:|---:|---|---|---|
| ✅ 01 | [fix-ai-fetch-redirect-policy](../dev-docs/archived/pbi/2026-10-18-01-fix-ai-fetch-redirect-policy.md) | fix | 16800 | 0.5 | 🟢 | 🟡 | ✅ 2026-10-19 完了（PR #180）。PBI 08 と共通 seam `NO_REDIRECT_FETCH_POLICY` で together 実装 |
| 02 | [fix-alarm-daily-purge-recreate](2026-10-18-02-fix-alarm-daily-purge-recreate.md) | fix | 5600 | 0.5 | 🟢 | 🟡 | run-1 持ち越し。既存ガード `ensureDailyFlushArmed` と共通化 |
| 03 | [fix-npm-mirror-lockfile-registry](2026-10-18-03-fix-npm-mirror-lockfile-registry.md) | fix | 4800 | 3.0 | 🟡 | 🔴 | 発生機構を特定済み（`~/.npmrc` + npm 9+ `replace-registry-host`）。lockfile 書換＋再発防止宣言＋静的ゲート |
| 04 | [fix-notification-consent-prestage](2026-10-18-04-fix-notification-consent-prestage.md) | fix | 4800 | 1.0 | 🟢 | 🟡 | consent 領域。PBI 05 と窗口整合 |
| ✅ 05 | [fix-privacy-consent-withdrawal-regrant](../dev-docs/archived/pbi/2026-10-18-05-fix-privacy-consent-withdrawal-regrant.md) | fix | 4800 | 3.0 | 🟡 | 🔴 | ✅ 2026-10-19 完了。撤回＋拒否の保全・PRIVACY.md 同期済み |
| 06 | [fix-trust-db-merge-union-removals](2026-10-18-06-fix-trust-db-merge-union-removals.md) | fix | 4000 | 5.0 | 🟡 | 🔴 | merge 方針再設計。既存 lockContract の期待値避け |
| 07 | [fix-buffer-key-retention-sweep-noop](2026-10-18-07-fix-buffer-key-retention-sweep-noop.md) | fix | 3000 | 0.5 | 🟢 | 🟡 | 再発コミット 195ff96 あり。テストモックの偽セマンティクス解消が本体 |
| ✅ 08 | [fix-obsidian-redirect-bearer](../dev-docs/archived/pbi/2026-10-18-08-fix-obsidian-redirect-bearer.md) | fix | 3000 | 0.1 | 🟢 | 🟡 | ✅ 2026-10-19 完了（PR #180）。read / write / 接続テストの 3 経路＋`redirected` 多層防御 |
| 09 | [fix-fallback-migration-partial-wipe](2026-10-18-09-fix-fallback-migration-partial-wipe.md) | fix | 1500 | 1.0 | 🟢 | 🔴 | 既存テストが壊れた挙動を pin（書き換え必須） |
| 10 | [fix-opfs-v2-verify-before-delete](2026-10-18-10-fix-opfs-v2-verify-before-delete.md) | fix | 1500 | 3.0 | 🟢 | 🔴 | 件数一致ガードは不成立（skip≠failure）。ROLLBACK 済みトランザクションの counter 過大報告を発見 |
| 11 | [fix-logger-pii-size-gate](2026-10-18-11-fix-logger-pii-size-gate.md) | fix | 1500 | 1.0 | 🟢 | 🟡 | 3 sink のみに閉じれば低リスク。`logTruncate` 再利用可 |
| 12 | [fix-settings-stale-patch-revert](2026-10-18-12-fix-settings-stale-patch-revert.md) | fix | 1200 | 2.0 | 🟡 | 🔴 | delta-write 契約の更新が必要 |
| 13 | [fix-fallback-quota-purge-order](2026-10-18-13-fix-fallback-quota-purge-order.md) | fix | 1000 | 1.5 | 🟢 | 🔴 | `purgeOldRecords` の maxRecords 分岐と exempt 不整合の裁定が要る |
| 14 | [fix-obsidian-host-encoded-ip](2026-10-18-14-fix-obsidian-host-encoded-ip.md) | fix | 1000 | 0.1 | 🟢 | 🟡 | `0x7f000001.nip.io` の誤拒否に注意 |
| 15 | [fix-hmac-kek-fail-open](2026-10-18-15-fix-hmac-kek-fail-open.md) | fix | 750 | 2.0 | 🟡 | 🔴 | 選択肢2（HMAC_SECRET 隔離）のみを先に切り出せる |
| 16 | [fix-markdown-ws-link-escape](2026-10-18-16-fix-markdown-ws-link-escape.md) | fix | 750 | 0.3 | 🟢 | 🟡 | `normalizeSingleLine` が空白区切り綴りを能動生成する構造 |
| 17 | [fix-recovery-migration-snapshot-remove](2026-10-18-17-fix-recovery-migration-snapshot-remove.md) | fix | 600 | 2.0 | 🟡 | 🔴 | 件数一致ガードは不成立。status 判定のみが有効 |
| 18 | [fix-storage-cross-context-cas](2026-10-18-18-fix-storage-cross-context-cas.md) | fix | 600 | 8.0 | 🔴 | 🟡 | MV3 に真の CAS が無く、窓を小さくする程度 |
| 19 | [fix-recovery-field-mapping-drift](2026-10-18-19-fix-recovery-field-mapping-drift.md) | fix | 600 | 1.0 | 🟢 | 🟡 | opfsRecovery のテストがリポジトリ全体で1件も存在しない |
| 20 | [fix-session-lock-fanout](2026-10-18-20-fix-session-lock-fanout.md) | fix | 400 | 1.0 | 🟡 | 🔴 | fan-out 宛先修正は別 PBI に分岐 |
| 21 | [fix-download-cap-unerased-entries](2026-10-18-21-fix-download-cap-unerased-entries.md) | fix | 333 | 1.5 | 🟡 | 🔴 | PBI 22 と同一関数（`:123-137`）を触る |
| 22 | [fix-purge-download-id-rebind](2026-10-18-22-fix-purge-download-id-rebind.md) | fix | 300 | 3.0 | 🟡 | 🔴 | PBI 21 と同一関数。`DownloadItem.startTime` 照合はスキーマ変更なしで旧レコードにも効く |
| 23 | [fix-idb-insert-returning-id](2026-10-18-23-fix-idb-insert-returning-id.md) | fix | 333 | 1.0 | 🟢 | 🟡 | 既に `INSERT_IGNORE_RETURNING_SQL` を保有 |
| 24 | [fix-restore-verify-count](2026-10-18-24-fix-restore-verify-count.md) | fix | 300 | 1.0 | 🟢 | 🔴 | 削除条件の変更のみ |
| 25 | [fix-gist-egress-csp-declare](2026-10-18-25-fix-gist-egress-csp-declare.md) | fix | 80 | 1.0 | 🟢 | 🔴 | 出荷済み機能が動作しないという fail-closed 側の不整合 |

## 推奨実行順（依存とファイル競合）

**進捗（2026-10-19）**: ~~01~~ / ~~08~~（PR #180 でマージ）と ~~05~~ は完了・アーカイブ済み。残り 22 件は下表のとおり。

- **B1（並列可・ファイル非重複）**: ~~01~~, ~~08~~, 14, 16, 23
  - 01 と 08 は `src/utils/fetch.ts` なので、redirect:'error' を共通 seam に切り出して together 実装すると efficiency 的
- **B2（並列可）**: 02, 04, 07, 09, 11, 24
- **B3（並列可・データ消失リスクあり・慎重なロールバック計画のもとで）**: ~~05~~, 13, 20, 21, 22
  - 21 と 22 は同一関数（`localMarkdownExportRetention.ts:123-137`）を触るため直列化
- **B4（並列可）**: 03, 06, 10, 12, 15, 17, 19
- **B5（単独・工数大）**: 18, 25

**2026-10-19 の完了で判明した追加の残課題**（PBI 2026-10-18-01 / 05 / 08 の実装と独立レビュー由来。9 件を RICE 採点して起票済み。実行順は [00-INDEX.md](00-INDEX.md) の 2026-10-19 節）:
- ✅ [2026-10-19-03-fix-consent-keys-settings-blob-relocation.md](../dev-docs/archived/pbi/2026-10-19-03-fix-consent-keys-settings-blob-relocation.md) — 単一オブジェクト設定移行が `privacy_consent` と拒否カウンタ 2 キーを `settings` ブロブへ畳む（PBI 05 由来。**局所再現済み**）。RICE 600。**2026-10-19 完了・アーカイブ済み**（同意の単位を allowlist に追加し、畳まれたプロファイルの救済を追加）
- ✅ [2026-10-19-02-fix-consent-gate-wiring-coverage.md](../dev-docs/archived/pbi/2026-10-19-02-fix-consent-gate-wiring-coverage.md) — `requireConsent` が未配線。同意ゲートの適用範囲（記録以外の外部送信）が未整理（PBI 05 の独立レビュー由来）。RICE 640。**2026-10-19 完了・アーカイブ済み**（ガイドに適用範囲の表を追加し、未使用 export を削除）
- ✅ [2026-10-19-10-fix-consent-recheck-scheduled-jobs.md](../dev-docs/archived/pbi/2026-10-19-10-fix-consent-recheck-scheduled-jobs.md) — **同意撤回後も記録が出ていく経路 3 件**（オフライン再送アラーム / 通知の「保存」 / 週次・月次レビュー要約）。受付時の同意は実行を許可しない（PBI 02 の独立レビューが実証）。RICE 480。**2026-10-19 完了・アーカイブ済み**（実行時再確認を採用し、キューは保持）
- ✅ [2026-10-19-11-fix-dashboard-obsidian-export-consent.md](../dev-docs/archived/pbi/2026-10-19-11-fix-dashboard-obsidian-export-consent.md) — ダッシュボードの「Obsidian へ追記」`append_to_obsidian` が同意ゲートの外（dashboardSqlite に同意コードが 1 つも無い）。PBI 02 の表の「Obsidian 書き出しは継承」を直接反証（PBI 02 の独立レビューが実証）。RICE 400。**2026-10-19 完了・アーカイブ済み**（実行時再確認を追加し、行を読む前に拒否）
- [2026-10-19-12-fix-settings-export-consent-record.md](2026-10-19-12-fix-settings-export-consent-record.md) — **設定のエクスポート/インポートが同意レコードを運ぶ**（PBI 02 の inventory 中に発見）。`sanitizeSettingsForExport`（`src/utils/settingsExportImport.ts:89-97`）は `CONFIRMED_PROVIDER_ORIGINS` と API キーしか剥がさず、`exportSettings` / `exportEncryptedSettings` は `settingsRepository.getAll()` から payload を作るため、`privacy_consent`（settings ブロブ経由でも scattered merge 経由でも）が書き出され、インポート先で同意が付与・撤回される。同意はデバイス・データ主体ごとの行為なので、除外とインポート時の扱い（再同意を求める）を決める必要がある。RICE 300
- [2026-10-19-07-fix-consent-return-path-settings.md](2026-10-19-07-fix-consent-return-path-settings.md) — 設定画面に同意へ戻る経路が無く、拒否時の案内文が実装と食い違う（PBI 05 の独立レビュー由来）。RICE 160
- ✅ [2026-10-19-06-fix-gist-tranco-redirect-policy.md](../dev-docs/archived/pbi/2026-10-19-06-fix-gist-tranco-redirect-policy.md) — gist / tranco の fetch が redirect を追従（PBI 01 / 08 由来。ADR 2026-08-29 の記述は訂正済み）。RICE 320。**2026-10-19 完了・アーカイブ済み**（5 サイトを `noRedirectInit` へ寄せ、2 次リクエストの不在を mock で固定）
- ✅ [2026-10-19-04-fix-redirect-real-behavior-e2e.md](../dev-docs/archived/pbi/2026-10-19-04-fix-redirect-real-behavior-e2e.md) — redirect 拒否の実挙動を検証したテストが 0 件。接続テストの `redirected` ガードも非対称（PBI 01 / 08 由来）。RICE 400。**2026-10-19 完了・アーカイブ済み**（実サーバ + 実ブラウザの E2E で転送先へのリクエスト 0 件を実測、接続テストに対称ガードを追加）
- ✅ [2026-10-19-05-fix-redirect-single-declaration.md](../dev-docs/archived/pbi/2026-10-19-05-fix-redirect-single-declaration.md) — 共通 seam が「単一宣言」になっていない（PBI 01 / 08 の独立レビュー由来）。RICE 400。**2026-10-19 完了・アーカイブ済み**（`noRedirectInit` の型 seam で後置上書きを `TS2353` にし、実定数を pin するテストを追加）
- ✅ [2026-10-19-01-fix-inmemory-port-version-key-fidelity.md](../dev-docs/archived/pbi/2026-10-19-01-fix-inmemory-port-version-key-fidelity.md) — `InMemoryStoragePort` が文字列値の `*_version` キーを捨てる（PBI 05 の検証中に実測で発見。`privacy_consent_version` / `gemini_api_version` / `tranco_version` がテストから見えない）。RICE 800。**2026-10-19 完了・アーカイブ済み**（なぜなぜ分析により `versions` マップを廃止）
- [2026-10-19-08-fix-testperf-jsdom-gate-attribution.md](2026-10-19-08-fix-testperf-jsdom-gate-attribution.md) — `jsdomFileCount` の 360 → 362 に推移と原因が無い（PBI 01 / 08 の独立レビュー由来。予算コメント自身の規約違反）。RICE 100
- [2026-10-19-09-fix-ledger-deep-mojibake-restore.md](2026-10-19-09-fix-ledger-deep-mojibake-restore.md) — 台帳に残る「意味が壊れた」文字化け断片の復元（2026-10-19 の一括修復で残った第 3 のクラス。スクリプトでは検出できない）。RICE 67

## ブロッカー調査結果（2026-10-18 実施）

監査中は実行が禁じられていたため needs_validation のままだったブロッカーを、監査完了後に 6 クラスタで調査した。**25 件中 18 件は局所再現で欠陥を実証（CONFIRMED）、3 件は仕様・ソースでブロッカー解消（RESOLVED）、4 件は構造確定のうえブラウザ実機観測が残る（PARTIAL/REMAINS）。** 再現テストはすべて一時ファイルで実行後に削除され、リポジトリに痕跡は残していない。

### 調査体制

| クラスタ | 範囲 | 手法 |
|---|---|---|
| W1 | sendMessage / alarms / storage.get / DownloadItem.id / Fetch 仕様 / IDB eviction | 公式 docs・仕様・Chromium/Firefox ソース |
| W2 | npm ミラーの運営者と忠実性 | 公開情報 + registry.npmjs.org との integrity 突合 |
| W3 | CommonMark / GFM / Obsidian のリンク描画 | 仕様 + node_modules の markdown-it による局所レンダリング |
| L1 | 04 / 05 / 06 / 11 / 12 / 15 / 19 / 20 | vitest による決定論的再現 |
| L2 | 07 / 09 / 10 / 13 / 17 / 24 | vitest による決定論的再現 |
| L3 | 01 / 08 / 18 / 21 / 22 / 23 | vitest による決定論的再現 |

### 横断ブロッカー6件の決着

| # | ブロッカー | 決着 | 根拠 |
|---|---|---|---|
| 1 | MV3 SW の `sendMessage` が自身に配送されるか | **配送されない**（仕様） | Chrome: "fired in every frame of your extension (except for the sender's frame)"。リスナあり無応答は resolve（null）、リスナ0のみ reject |
| 2 | `storage.local.get('local_export_')` の prefix マッチ | **存在しない（exact-key）** | Chrome docs: 文字列は "A single key to get"。列挙は `get(null)` / `getKeys()` のみ |
| 3 | IDB eviction が KEK を消すか | **unlimitedStorage 付与済みなら免除** | Chrome/Firefox とも unlimitedStorage が eviction を免除。残る経路はプライベートモードと拡張削除のみ |
| 4 | `npm.flatt.tech` の正体 | **GMO Flatt Security の Takumi Guard**（公開 SaaS 型セキュリティプロキシ） | 10/10 パッケージで integrity 完全一致、tarball は 302 で公式 registry.npmjs.org へ。供給網侵害の兆候 0 件 |
| 5 | `DownloadItem.id` のセッション持続 | **Chromium は持続 / Firefox は非持続** | Firefox ソースに `TODO Bug 1247794`（未解決）。起動時に 1 から採番し直す |
| 6 | Obsidian が `[text] (url)` をリンク描画するか | **描画しない** | CommonMark Example 511・GFM Example 520・Obsidian 公式 docs とフォーラム実測のいずれも非リンク |

追加で判明した重要事実:
- **リダイレクト時の Authorization は 3 エンジンとも剥がれる**が、**`x-goog-api-key` は剥がれない**（Fetch 仕様の CORS non-wildcard は Authorization のみ）。Gemini 経路は重大度維持、Bearer 経路は本文転送に限定。307/308 は本文保持。クロスオリジンかつ CORS-unsafe ヘッダ付きなら preflight が先行するため、**転送先が preflight に応答しない限り実リクエストは発行されない**。
- **Chrome docs 自身が alarms の get-then-create ガードを推奨**（PBI 02 の方針は公式パターン）。
- **npm ≥ 11.15.0 の EALLOWREMOTE**: 設定レジストリと lockfile の tarball ホストが一致しない依存を拒否する。**オーナー判断（2026-10-18）により `~/.npmrc` の Takumi Guard 設定は残す**（開発機の他プロジェクトでは悪性パッケージのブロックとして実際に有効なため）。そのため PBI 03 は **プロジェクト直下の `.npmrc` に `registry=https://registry.npmjs.org/` と `replace-registry-host=never` を置く**方針とし、リポジトリ内の設定レジストリを公式に固定する（npm の設定優先順位はプロジェクト > ユーザー）。これで再発と EALLOWREMOTE の両方を防げる。トレードオフとして、このリポジトリの依存取得では Takumi Guard のブロックが効かなくなる。

### PBI 別判定（25件）

| NN | 判定 | 決め手 |
|---|---|---|
| 01 | 構造確定 + 仕様確定 | redirect オプション無しを pin。Authorization 剥がし／`x-goog-api-key` 残存／preflight 前提を仕様で確定 |
| 02 | **RESOLVED** | 同名 create は cancelled and replaced（カウントダウンリセット）を docs で確定 |
| 03 | **RESOLVED（性質変更）** | Takumi Guard と判明、10/10 integrity 一致。供給網リスクはほぼ解消、無宣言依存と再発性が残る |
| 04 | **CONFIRMED** | 撤回状態でも `deps.record` が 1 回呼ばれる |
| 05 | **CONFIRMED** | `hasConsented:true` 再付与・withdrawal 消失・履歴 null |
| 06 | **CONFIRMED** | storage 書き戻しで削除済みドメインが version bump 付きで復活 |
| 07 | **CONFIRMED** | exact-key で恒久 no-op。捏造 prefix モックは API 契約違反と確定 |
| 08 | 構造確定 + 仕様確定 | redirect 無し。Bearer は剥がれるため本文転送とリクエスト到達が残る |
| 09 | **CONFIRMED** | 部分失敗で clearAll、失敗行の唯一のコピーが破壊 |
| 10 | **CONFIRMED** | 非 throw 部分 count で deleteOldDb。ROLLBACK 後のカウント過大報告も再現 |
| 11 | **CONFIRMED** | 70000 文字で原文メール残存、65000 文字はマスク（対照成立） |
| 12 | **CONFIRMED** | 再暗号化 patch が新キーを巻き戻す／whitelist 並行追加で 1 件喪失 |
| 13 | **CONFIRMED** | dedupe 前 purge・star exempt なし・幾何減衰 `[18,17,16,15,14]` |
| 14 | **CONFIRMED** | Node WHATWG で hex 形は 127.0.0.1 に再解釈、10進単独形は拒否、`0x7f000001.nip.io` は再解釈されない |
| 15 | **CONFIRMED（重大度↓）** | 鍵の黙示回転・隔離なし・consent リセットを再現。eviction 経路は unlimitedStorage でほぼ閉鎖 |
| 16 | **RESOLVED（価値↓）** | どのレンダラでもリンクにならない。価値は偽リンク表記の防止に縮む |
| 17 | **PARTIAL** | fail-open ゲート通過と snapshot-remove を再現。実環境の status 失敗・set→remove 順序は owner |
| 18 | **CONFIRMED** | 2 writer の verify→set 窓で lost update、ConflictError 不発。ブラウザ IPC の咬み合いは owner |
| 19 | **CONFIRMED** | `fallback_reason` が `undefined` に NULL 化、元キー削除で復元不能 |
| 20 | **CONFIRMED** | cachedEncryptionKey null 状態で IS_LOCKED 検査スキップ、鍵導出。sendMessage 仕様も確定 |
| 21 | **CONFIRMED** | 201 件で cap 落ちした id 0/1 が removeFile/erase に一度も渡らない |
| 22 | **CONFIRMED（Firefox 限定）** | search 0 回で stored id を直接 erase。Firefox の id 非持続で実在欠陥 |
| 23 | **CONFIRMED** | A が B の id=2 を受領。real engine 19 件は GREEN。実機 interleave は範囲外 |
| 24 | **CONFIRMED** | 件数不足でもバックアップ削除＋DONE 設定 |
| 25 | **REMAINS** | origin 未宣言の構造は確定。MV3 の connect-src 適用実機確認は owner |

### 調査後の改訂スコアと推奨順

調査で Reach・Impact・Confidence が動いたため、RICE を再計算した。**旧表には計算式と数値が一致しない項目があり、以下が正式値**（要素は調査結果を反映、Effort は不変）。

| 改訂順 | NN | RICE | 旧値 | 変動理由 |
|---|---:|---:|---:|---|
| 1 | 01 | 11200 | 16800 | Impact 3→2（preflight 前提で実害が条件付き） |
| 2 | 05 | 4000 | 4800 | 旧表の計算誤りを訂正 |
| 3 | 04 | 4000 | 4800 | 同上 |
| 4 | 02 | 4000 | 5600 | 同上 |
| 5 | 06 | 4000 | 4000 | 変化なし |
| 6 | 07 | 3000 | 3000 | 変化なし |
| 7 | 03 | 2000 | 4800 | Impact 2→1、Confidence 80→100（供給網侵害なし確定） |
| 8 | 09 | 1500 | 1500 | 変化なし |
| 9 | 10 | 1500 | 1500 | 変化なし |
| 10 | 11 | 1500 | 1500 | 変化なし |
| 11 | 08 | 1500 | 3000 | Impact 1→0.5、Confidence 80→100 |
| 12 | 12 | 1000 | 1200 | 旧表の計算誤りを訂正 |
| 13 | 13 | 1000 | 1000 | 変化なし |
| 14 | 14 | 1000 | 1000 | 変化なし |
| 15 | 19 | 500 | 600 | 旧表の計算誤りを訂正 |
| 16 | 17 | 250 | 600 | 旧表の計算誤りを訂正 |
| 17 | 20 | 250 | 400 | 同上 |
| 18 | 16 | 250 | 750 | Impact 0.5→0.25（リンクにならない確定） |
| 19 | 18 | 200 | 600 | 旧表の計算誤りを訂正 |
| 20 | 15 | 150 | 750 | Reach 100→30（eviction ほぼ閉鎖） |
| 21 | 24 | 125 | 300 | 旧表の計算誤りを訂正 |
| 22 | 21 | 83 | 333 | 同上 |
| 23 | 23 | 42 | 333 | 同上 |
| 24 | 22 | 38 | 300 | Reach 100→30（Firefox 限定）、Confidence 50→100 |
| 25 | 25 | 10 | 80 | 旧表の計算誤りを訂正 |

**ファイル名の NN は初回採点時の順位のまま**（相互参照の破壊を避けるため）。実行順は上の改訂順に従うこと。必要なら NN の振り直し（リネーム＋相互参照更新）も可能だが、リンク切れのリスクを伴う。

### 調査で追加された owner アクション

1. **（実施しない判断・2026-10-18）`~/.npmrc` の Takumi Guard 設定は残す**: 開発機の他プロジェクトで悪性パッケージのブロックとして実際に有効なため。代わりに PBI 03 でリポジトリ直下の `.npmrc` に公式 registry と `replace-registry-host=never` を宣言し、このリポジトリ内でのみ挙動を固定する。
2. **プライベートモードでの KEK 損失観測**（PBI 15）: split incognito の拡張コンテキストで IDB が消えるか。
3. **PNA/LNA の適用確認**（PBI 01/08）: 拡張 SW から public→loopback への fetch に Private Network Access が適用されるか。
4. **Obsidian 実機の 1 行観測**（PBI 16）: 隔離 vault で `[text] (url)` が非リンクであることを確認（調査ではほぼ確定）。
5. **残り 1080 件の integrity 突合**（PBI 03）: 必要ならスクリプト化して全件照合。

## 却下（rejected）— PBI 化しない4件

ソースで反証済みのため、次回ランで evidence が変わるまで再主張しない。詳細と fingerprint は
`findings.json` と REPORT.md の Rejected 節を参照。

| fingerprint | 反証の要旨 |
|---|---|
| `derived-markdown-sinks:entry-ssot-terminator-normalization-bypass` | 両シンクとも同一所有者のコピー（自分の Downloads と自分の secret Gist）。行構造は正当な markdown であり、可視化手上的整形は cosmetic |
| `opfsMigrationV2Reader.readOldDbRecords:ten-column-select-drops-legacy-columns` | 旧 OPFS プールの DDL 履歴（158b4221 / 494181e6）が、落ちた列が当時から存在しなかったことを示す。唯一の実害（`obsidian_synced` の 0 化）は再ミラー相当 |
| `03edd885…`（built-in AI の quota 会計） | 下信頼エントリポイント無し（`externally_connectable` 宣言なし）。スキップされたゲートは有料 API 費用目的の意図的スコープ |
| `settings-blob:cross-context-verify-then-set-stale-writer` | popup / dashboard / SW は同一 principal の自己レース。攻撃者制御の writer が両側に存在しない |