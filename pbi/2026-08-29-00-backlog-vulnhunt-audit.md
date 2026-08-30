# バックログ優先度一覧 — 2026-08-29 VulnHunter 監査対応

## 進捗（2026-08-30 時点）

PR #67–#81 で対応。**完全着地 13 件は `dev-docs/archived/pbi/` へ移動済み**:
01 / 02 / 03 / 05 / 07 / 09 / 10 / 11 / 15 / 16 / 17 / 18（+ クレンジング系 30-15）。

`pbi/` に残置（このバックログ内の記述は着手当時のもの、状態は `00-INDEX.md` 参照）:
- **部分着地**: 04（2/6・残は 16 で完了）/ 08（3/7・残は 17/18 で完了）/ 13（HMAC は 12 へ統合）/ 14（AC1 は 19 へ分離）
- **未着手**: 06（信頼境界・高リスク）/ 12（暗号 SSOT + HMAC 先行化・高リスク）/ 19（CSPValidator 自己許可・follow-up）

以下、監査当時の索引をそのまま残す（トレーサビリティ・なぜなぜ分析の参照用）。

---

## この索引の読み方

- **着手順**: ファイル名の連番 `NN` が RICE 順位と一致する（`01` が最優先）。実際の着手は「依存関係と並列性（Wave 提案）」に従う。`pbi/00-INDEX.md` の表順もこれに合わせる。
- **VulnHunter 結果ディレクトリ（`obsidian-smart-history_VULNHUNT_RESULTS_2026-08-29-165536/`）はリポジトリに含まれない**（`.gitignore` の `*_VULNHUNT_RESULTS_*` で除外、ローカルにも未保管）。PoC / exploit_tests の完全な再現入力は復元不可。攻撃の具体（実測値・シナリオ形状）は下記「なぜなぜ分析（フェーズ3）」の各クラスタ節に要約されている（例: C1 は 30ドット→8265ms、C4 はバッファ `final=['E2']` / リトライキュー `['A','B']→['A']`）。各 PBI のテストは受け入れ基準（BDD シナリオ）から起こす。
- 行番号は監査時点（2026-08-29、ブランチ `fix/test-updates-and-cleanup [5d3005a6]`）のもの。着手時に該当シンボルで再確認すること。

## 候補の列挙（フェーズ0）

VulnHunter 2026-08-29 スキャンで確認された **48件の脆弱性（Medium 3 / Low 45）**
と **Code Quality 9件** を、修正戦略が共通するルート原因ごとにクラスタリングし、14候補に整理した。
その後、C14 に含めていた orphan-key 機能バグ（pending パネルのホワイトリスト追加が無効）は
実在のユーザー影響があるため `2026-08-29-15` として分離した（計 15 PBI）。

| # | 候補（クラスタ） | 含まれる指摘 | 種別 |
|---|---|---|---|
| C1 | 正規表現安全性（線形検証・ワイルドカード上限・保存時バリデーション） | VULN-025(M), 026 | fix |
| C2 | Markdown/Obsidian 出力サニタイズ境界の確立 | VULN-001(M), 008, 047 ＋ VULN-045/046 相当のハードニング | fix |
| C3 | レスポンスボディ読み込みのバイト上限ユーティリティ | VULN-013, 015, 027, 054, 055 | fix |
| C4 | chrome.storage 読み書きの直列化（RMW・単一実行・CAS） | VULN-003, 005, 009, 012, 050, 056 | fix |
| C5 | SQLite クエリ limit の両側クランプ統一 | VULN-017, 021, 048, 049 | fix |
| C6 | 信頼境界の一貫性（ゲート迂回経路の解消） | VULN-002, 011, 018, 042 | fix |
| C7 | ロック/CAS 運用の正しさ（try/finally・current マージ） | VULN-028, 029 | fix |
| C8 | リソース上限とライフサイクルの境界強制 | VULN-004, 006, 007, 024, 041, 051, 053 | fix |
| C9 | FETCH_URL リダイレクト再検証（SSRF） | VULN-016 | fix |
| C10 | ログ完全性（attribution・制御文字無害化） | VULN-019, 044 | fix |
| C11 | storageFallback ミューテータ統一 | VULN-022(M) | fix |
| C12 | 暗号・認証ポリシーの単一情報源化 | VULN-010, 037, 038, 039, 040, 052 | fix |
| C13 | インポート経路の安全化（認証→上限→パース→検証） | VULN-023, 030, 034, 035, 036 | fix |
| C14 | Code Quality ハードニング一括（将来攻撃面6件） | CSPValidator 自己許可, urlWhitelist 自己許可, Gemini path, TSV 数式無害化, models-dev スキーマ検証, 旧a.hrefパネル | fix |
| C15 | orphan-key 機能バグ（C14 から分離） | pending パネルのホワイトリスト追加が orphan キー `'domainWhitelist'` に書かれ無効 | fix |

- 全 48 指摘 + Code Quality 9件が過不足なく C1–C15 に割り当て済み（トレーサビリティ表は下記）
- 誤検知6件（VULN-014/020/031/032/033/043）とスイープ除去2件（VULN-045/046）は PBI 化対象外
  （045/046 のシンクは C2 にハードニングとして吸収）

---

## 各候補の理解（フェーズ1）

| 候補 | 何を作るか | 誰のため | なぜ必要 | 制約 |
|---|---|---|---|---|
| C1 | `DOMAIN_VALIDATION` を線形 label-wise 検証に置換、`matchesPattern` を `wildcardToRegex`（上限付き）に統一、フィルタ保存時バリデーション | 全利用者（第三者配信フィルタリストを購読する人） | 実測 8.3秒の指数 ReDoS が Service Worker を停止。1 regex 置換で消える最安の Medium | 正当なドメイン（`*.example.com` 等）を拒否しないこと、既存テスト 47件の互換維持 |
| C2 | `sanitizeForObsidian` の HTML エンティティ化＋既存 `sanitizeForMarkdownLinkText` の適用漏れ解消（legacy formatter / 2 sync-target / タグ） | Obsidian 連携利用者全員 | ページ由来 HTML が日次ノートにそのまま書かれ、レンダラ次第で実行されうる。link-text ヘルパー自体は前回レビューで導入済み | ノートの可読性を損なわないエンティティ化、既存消費者の出力互換 |
| C3 | `readBodyCapped(response, maxBytes)` を新設し 8 シンク（Obsidian/FETCH_URL/Tranco/AI×4/Gist）を置換 | 全利用者 | Content-Length 省略（chunked）で上限が無効化され SW メモリ枯渇（実証: 64–200MB 確保） | タイムアウト維持、post-read チェックは防御深度として残す |
| C4 | 6 サイト（MarkdownBufferManager/pendingStorage/logger storageAdapter/PersistentRetryQueue/notificationHandlers/optimisticLock）に CAS/Mutex/単一実行を適用 | 全利用者（通常運用でデータ消失が起きうる） | MV3 のマルチコンテキスト並行性でエントリ消失・重複記録・ジョブロストが実証済み | 既存 `withOptimisticLock`/`Mutex` パターンの再利用、`aiUsageTracker` を正解パターンとする |
| C5 | `queryPlan` と handler で `Math.max(1, Math.min(...))` に統一（4 シンク） | ダッシュボード利用者 | `LIMIT -1` が SQLite で無制限を意味し、監査ログ全件materialization が可能 | 読み取り系の既定値（100/50/1000）維持 |
| C6 | loader 両ブランチで SW CHECK_DOMAIN 待ち、オフラインリプレイの force 解除、`confirm_token` サブタイプ廃止＋パーアクション発行、権限レベルラダー | 全利用者 | ページ属性・リプレイ・同一チャネル・権限要求の 4 経路が trust シームを迂回する | e2e テスト互換、破壊的操作 UX 維持、既存 PermissionManager 再利用 |
| C7 | trancoUpdater を try/finally 化、trustDb updateFn を current マージ型に修正 | 全利用者 | 1 回の失敗で Tranco 更新が恒久ロックアウト、同時書き込みの差分が静黙に失われる | ロック API 契約の型表現 |
| C8 | schema 駆動 payloadGuard、書き込み境界での truncate/cap（header value・tags・文数・ノード数）、`local_export_*` retention、`clearExpiredPages` 配線 | 全利用者 | 無限成長（8.9GB/5年モデル）と二次計算の O(n²) 爆発が実証済み | 上限値は既存 precedent（1024文字/50タグ等）に合わせる |
| C9 | FETCH_URL に `redirect: 'error'`（または manual + ホップ毎再検証）を適用 | フィルタリスト import 利用者 | 許可 URL → private IP へのリダイレクトで SW が内部応答を取得・返却（実証済み） | 正常なリダイレクト（同一オリジン http→https 等）の扱いを決める |
| C10 | LOG_FORWARD の `_source` を sender 由来に、logger 境界で制御文字/ANSI 無害化 | 全利用者 | ログの偽装・多行注入が永続化される（実証済み）。障害解析の一次証跡が信頼できない | PII マスク維持、性能影響なし |
| C11 | storageFallback に `mutate(fn)` ヘルパーを新設し 8 ミューテータ全てを経由させる | OPFS 不使用環境の利用者 | 6/8 ミューテータがロックなしで RMW → purge が取り消される等（実証済み） | OPFS 正常環境への影響ゼロ（フォールバック専用） |
| C12 | 暗号パラメータ SSOT（iterations・ポリシー・KDF ラッパー）、KEK session-only 化＋`deriveHmacWrappingKey` 配線、RateLimit の local 永続化、init mutex、弱い平行実装削除 | マスターパスワード設定者 | 硬化版が実装済みでも死蔵コードのため弱い経路が本番に残る（5 指摘の共通根） | アンロック UX・既存暗号データの移行互換 |
| C13 | 共通インポートプリミティブ（認証→サイズ上限→パース→行検証）を 3 系統に適用、YAML フロントマター エスケープ、validateRow 全フィールド化 | ファイル import 利用者 | 復号・パースが署名検証より先に走り、署名なし履歴偽造が可能（実証済み） | 既存エクスポートファイルの後方互換（iterations フィールド追加は任意読み込み） |
| C14 | CSPValidator/urlWhitelist 自己許可の締め直し、Gemini path エンコード、TSV 数式無害化、models-dev スキーマ検証、旧a.hrefパネルに isSecureUrl | 全利用者 | 将来の攻撃面になるハードニング6件 | 既存 UI 動作の非破壊 |
| C15 | orphan-key ホワイトリストバグ修正（`StorageKeys.DOMAIN_WHITELIST` 経由への統一） | pending 導線の利用者 | 機能が沈黙して効かない（追加操作が orphan キーに書かれ誰も読まない） | 既存 UI 動作の非破壊、既存 `domain_whitelist` の値を保持 |

監査の原資料（README.md / phase2b / phase3 / phase3d / poc/ / exploit_tests/）は
`.gitignore` 除外の結果ディレクトリにありリポジトリ外。攻撃の具体は下記「なぜなぜ分析」節に要約済み。

---

## 優先度付け（フェーズ2） — RICE

### スコアリング

**計算式**: `RICE = (Reach × Impact × Confidence) / Effort`（Effort 単位: 人月。1pt ≈ 0.1人月）

| 順位 | 候補 | Reach | Impact | Confidence | Effort | RICE | 根拠 |
|---|---|---|---|---|---|---|---|
| 1 | C1 regex 安全性 | 1000 | 0.5 | 0.95 | 0.1 | **4750** | 第三者配信フィルタリストで全利用者が攻撃対象（unauth-web 相当）。実測 8.3秒の指数 ReDoS。修正は 1 regex 置換＋ヘルパー再利用で最安 |
| 2 | C2 Markdown サニタイズ境界 | 1000 | 0.5 | 0.95 | 0.1 | **4750** | Medium の HTML 注入。link-text ヘルパーは前回レビューで導入済みのため残タスクはエンティティ化＋適用漏れ解消のみ（Effort 0.2→0.1、当初スコア 2375 から再評価） |
| 3 | C3 レスポンス読み込み上限 | 1000 | 0.35 | 0.95 | 0.2 | **1663** | 5 指摘・8 シンクを 1 ユーティリティで解消。攻撃者は任意サイトの応答ヘッダ/ボディ（chunked）で到達可能 |
| 4 | C4 storage RMW 直列化 | 800 | 0.4 | 0.9 | 0.2 | **1440** | 通常の MV3 並行動作で記録・ログ・リトライジョブが静黙消失（攻撃不要）。データ完全性 Impact |
| 5 | C5 limit 両側クランプ | 400 | 0.35 | 0.95 | 0.1 | **1330** | DASHBOARD_SQLITE は extension-only（Reach 抑制）だが監査ログ全件流出・無制限 materialization。修正は clamp 1 行系 |
| 6 | C6 信頼境界一貫性 | 700 | 0.4 | 0.9 | 0.2 | **1260** | 002（任意ページがゲート迂回）を含む 4 指摘。セマンティクス変更（リプレイ force 解除等）で Confidence 0.9 |
| 7 | C7 ロック/CAS 運用 | 500 | 0.25 | 0.9 | 0.1 | **1125** | 恒久ロックアウト＋CAS LWW。発生頻度は低いが復旧に手動介入が必要 |
| 8 | C8 リソース上限・ライフサイクル | 800 | 0.3 | 0.9 | 0.2 | **1080** | 長期利用での無限成長（実測モデル 8.9GB/5年）＋O(n²) 爆発。全利用者の長期健全性 |
| 9 | C9 リダイレクト SSRF | 300 | 0.35 | 0.95 | 0.1 | **1000** | FETCH_URL 経由（extension-only＋import ユーザー）だが private IP 到達は実証済み。fetch.ts 1 箇所修正 |
| 10 | C10 ログ完全性 | 300 | 0.25 | 0.95 | 0.1 | **713** | ログ偽造は診断信頼性の問題（情報影響）。logger 1 境界＋handler 1 箇所 |
| 11 | C11 storageFallback 統一 | 100 | 0.5 | 0.95 | 0.1 | **475** | Medium だがフォールバックモード（OPFS 不使用環境）限定で Reach 低。修正はヘルパー抽出 1 件 |
| 12 | C12 暗号 SSOT | 400 | 0.4 | 0.85 | 0.3 | **453** | KEK 平文・100k KDF・レート制限迂回等の実質。ただし暗号変更は回帰リスクが高く Confidence/Effort を penalize |
| 13 | C13 インポート安全化 | 300 | 0.3 | 0.9 | 0.2 | **405** | 署名なし履歴偽造（035）を含む。ファイル import ユーザー限定 |
| 14 | C14 Code Quality ハードニング | 300 | 0.1 | 0.85 | 0.15 | **170** | 将来攻撃面 6 件。個々は小さいが束ねて 1 PBI（orphan-key バグは C15 に分離） |
| — | C15 orphan-key 機能バグ | 300 | 0.4 | 0.95 | 0.05 | **2280** | pending パネルのホワイトリスト追加が沈黙。2 行の書き換え。Wave 1 で即着手 |

### 依存関係と並列性（Wave 提案）

- **Wave 1（全並列・ファイル触接なし）**: 01 regex / 02 markdown / 03 body-caps / 05 limit-clamp / 09 redirect-ssrf / **15 orphan-key**
- **Wave 2（並列可）**: 04 storage-RMW / 07 lock-CAS / 08 resource-caps / 10 log-integrity / 11 fallback / 13 import
  - 注意: 03 / 09 / 10 はいずれも `src/background/handlers/systemHandlers.ts` を触る（03: FETCH_URL 応答読み取り ~98-108 行、09: FETCH_URL の fetch オプション ~87 行、10: LOG_FORWARD の `_source` ~258-264 行）→ 同一ブランチにまとめるか、03→09→10 の順にマージしコンフリクトを確認
  - 04（optimisticLock.ts）と 07（trustDb/trancoUpdater）は理論上 04 のロック強化が 07 の CAS 修正と相互作用 → 04 先着手を推奨
- **Wave 3（高リスク・単独）**: 06 trust-boundary / 12 crypto-SSOT — 既存動作のセマンティクス変更を含むためレビュー強化
- **任意タイミング**: 14 code-quality（ハードニングのみ）

### 最終順位

1. `2026-08-29-01-fix-regex-safety.md`（RICE 4750）
2. `2026-08-29-02-fix-markdown-sanitizer-boundary.md`（4750 — 再評価。ファイル名連番は据え置き）
3. `2026-08-29-03-fix-response-body-caps.md`（1663）
4. `2026-08-29-04-fix-storage-rmw-serialization.md`（1440）
5. `2026-08-29-05-fix-query-limit-clamp.md`（1330）
6. `2026-08-29-06-fix-trust-boundary-consistency.md`（1260）
7. `2026-08-29-07-fix-lock-cas-correctness.md`（1125）
8. `2026-08-29-08-fix-resource-boundary-caps.md`（1080）
9. `2026-08-29-09-fix-fetch-redirect-ssrf.md`（1000）
10. `2026-08-29-10-fix-log-integrity.md`（713）
11. `2026-08-29-11-fix-storagefallback-mutate.md`（475）
12. `2026-08-29-12-fix-crypto-policy-ssot.md`（453）
13. `2026-08-29-13-fix-import-pipeline-safety.md`（405）
14. `2026-08-29-14-fix-security-hardening-code-quality.md`（170 — ハードニングのみ）
15. `2026-08-29-15-fix-pending-whitelist-orphan-key.md`（2280 — C14 から分離。着手は Wave 1）

### フォローアップ PBI（部分完了分から分離）

Wave 2 / Wave 3 で着地しきれなかった残タスクを新規 PBI として切り出した。

- `2026-08-29-16-fix-cas-verify-write-serialization.md` — 29-04 の残 4 サイト（buffer/pending/logger の CAS + `optimisticLock` の verify→write 直列化）。fake-timer 互換の key 粒度 Mutex 設計が主眼。VULN-003/005/012/050
- `2026-08-29-17-fix-local-export-retention.md` — 29-08 の VULN-004。ローカル Markdown 自動エクスポートの retention（download 記録の purge + 日次バッファのエントリ上限）
- `2026-08-29-18-fix-secondary-compute-input-caps.md` — 29-08 の VULN-041/051/053。タグ共起・TextRank・タグクラスタ配置の O(n²) 計算への入力 cap
- `2026-08-29-19-fix-cspvalidator-self-allow.md` — 29-14 の AC1。`CSPValidator.initializeFromSettings` の設定由来 hostname 無条件許可を `isAllowedProviderBaseUrl` 相当のガード（private IP・metadata・非 https）で締め直す。「何を正当なカスタム API エンドポイントとみなすか」の設計判断を含む

**29-13 / 29-04 の HMAC 先行化（VULN-034）と log 署名（VULN-035）** は暗号エクスポート形式の変更
（平文 JSON 署名 → ciphertext 署名）を伴うため、独立 PBI にせず `2026-08-29-12-fix-crypto-policy-ssot.md`
のスコープに追記して統合対応する。

---

## 疑問の解決 — なぜなぜ分析（フェーズ3）

各クラスタの「なぜその問題が存在するのか」を 5 Whys で根源まで掘り下げ、
**原因 → 示唆 → 解** を導出した。PBI の修正方針はすべてこの解に基づく。

### C1: なぜ Service Worker が 8 秒固まるのか？

1. **なぜ固まる？** → 検証 regex が入力長に対し指数的にバックトラックする（実測: 22ドット→253ms、30ドット→8265ms）。
2. **なぜ指数的？** → 文字クラス内のドットが partition ambiguity を生む nested-quantifier 構造のため、1 文字が多数の解析経路を持つ。
3. **なぜそのような regex が許される？** → `wildcardToRegex` には `MAX_WILDCARDS_PER_PATTERN=5` の上限があるのに、検証用 regex は別実装で複雑度のレビューを受けていない。
4. **なぜレビューされない？** → ReDoS を検出するテスト規約（状態数増加の計数・タイミングテスト）が codebase に存在しない。
5. **なぜ規約がない？** → 「ユーザー/第三者由来の文字列から regex を作るな。作るなら線形であることを証明せよ」という設計原則が文書化されていない。

**原因 → 示唆 → 解**:
- 原因: `ublockParser/constants.ts:43` の構造（singular choke point）と `urlSkipper.ts:52-58` の無上限展開。
- 示唆: 15 regex サイトのうち 13 は境界付きで安全（スイープ済み）。問題は「パターン→regex 変換の複雑度保証がない」ことのみ。
- 解: 検証を label-wise 線形処理に置換、matchesPattern を上限付き wildcardToRegex に統一、保存時バリデーションで未検証保存（domainFilter.ts:319-337）を封鎖、タイミング/状態数テストを規約化。

### C2: なぜ HTML が Obsidian ノートに書かれるのか？

1. **なぜ HTML が乗る？** → `sanitizeForObsidian` が markdown リンク/wikiリンク構文のみをエスケープし、HTML タグは素通し（実証済み）。
2. **なぜリンク構文だけ？** → 当初の脅威モデルが「リンク経由フィッシング」に限定され、HTML は Obsidian 側のレンダラが無害化するという楽観があった。
3. **なぜ楽観が放置される？** → 関数名が「サニタイズ済み」を宣言しているのに、実際は部分変換であることが型やテストで表現されていない。
4. **なぜ表現されない？** → 「Obsidian に書き出してよい文字列」の不変条件（出力境界の契約）が設計文書に存在しない。
5. **なぜ存在しない？** → sink 側で保証する設計（boundary guarantee）が codebase の原則として確立されておらず、各消費者が場当たり的に防御してきた。

**原因 → 示唆 → 解**:
- 原因: 境界関数の契約が曖昧＋4 消費者が同一の join パターンを複製（formatMarkdownStep/markdownExport/saveLocalMarkdownStep/markdownFormatter）。
- 示唆: 16 呼び出しサイトはすべて単一 choke point を通るため、境界関数を正せば全消費者が治る（スイープ: 16/8 ファイル、Remaining 0）。
- 解: `sanitizeForObsidian` に HTML エンティティ化を追加（完全境界化）、結合安全なフラグメントエスケープヘルパーを新設して join 前に各断片へ適用、境界契約を DESIGN_SPECIFICATIONS に明記。死蔵 sync-target（045/046）にも同一ヘルパーを事前適用。

### C3: なぜメモリが攻撃者の支配下にあるのか？

1. **なぜメモリが尽きる？** → `response.text()/json()` が応答全体を SW メモリにバッファする（実証: 64–200MB 確保）。
2. **なぜ全体をバッファ？** → 上限チェックが Content-Length ヘッダの存在を前提とし、chunked（ヘッダ省略）で素通しする。
3. **なぜヘッダ依存？** → サイズ上限が「検証」ではなく「読み取り後/読み取り前の条件分岐」として各所に手書きされている。
4. **なぜ手書き？** → fetch ヘルパー層（`fetchWithTimeout`）が時間だけを抽象し、サイズの抽象を持たない。
5. **なぜサイズを抽象しない？** → 「ネットワーク入力はバイト上限内でのみ読む」という取得規約が存在しない。

**原因 → 示唆 → 解**:
- 原因: `response.text()` の素使用が 12 本番シンクに散在（うち 8 が攻撃到達可能）。
- 示唆: 1 つのユーティリティ（バイトカウント付きストリーミング読み取り）で全シンクを置換でき、将来の fetch 追加も規約で防げる。
- 解: `readBodyCapped(response, maxBytes)` を新設、8 シンクを置換、既存 post-read チェックは防御深度として維持。

### C4: なぜ通常運用でデータが消えるのか？

1. **なぜデータが消える？** → get→mutate→set の RMW が他コンテキストの書き込みを stale スナップショットで上書きする。
2. **なぜ上書きされる？** → 52 ファイル中 20 の RMW 形状サイトのうち、ロック適用は 4 サイトのみ（スイープ済み）。
3. **なぜ適用されない？** → ロック（`withOptimisticLock`/`Mutex`）はオプトイン API で、使わなくても型・lint で検出されない。
4. **なぜ検出されない？** → `StoragePort` に「共有キーへの RMW は CAS 経由のみ」という API 規約・強制がなく、生 `chrome.storage` 直参照が許容されている。
5. **なぜ許容される？** → MV3 の SW/popup/dashboard/offscreen 並行性が設計原則として明文化されず、単一コンテキスト前提の実装が混在してきた。

**原因 → 示唆 → 解**:
- 原因: 6 確認サイト（buffer/pending/logger/queue/notification/optimisticLock 内部）の個別事情ではなく、規約の欠如。
- 示唆: 正解パターン（`aiUsageTracker` の `withCounterLock`、`contextMenuHandlers` の single-flight、`savedUrlRepository` の CAS）は codebase 内に既存。
- 解: 6 サイトに既存パターンを適用、`optimisticLock` の verify→set を Mutex で直列化、「RMW は CAS 経由」を DESIGN_SPECIFICATIONS に明記し Coverage/レビュー観点に追加。

### C5: なぜ `LIMIT -1` が全件返すのか？

1. **なぜ全件？** → SQLite は負の LIMIT を「無制限」と解釈する。
2. **なぜ素通し？** → 4 シンクの clamp が `Math.min`（上側）のみ。
3. **なぜ上側だけ？** → limit を「大きすぎる値の問題」としてのみ捉え、符号を問題視していなかった。
4. **なぜ視野が狭い？** → limit 検証の共通関数がなく、handler/engine/mapper の各層で重複実装されている。
5. **なぜ重複する？** → `queryPlan.ts`（ADR 2026-08-27-limit-policy）に集約しきれておらず、層ごとの手当てが残存している。

**原因 → 示唆 → 解**:
- 原因: `Math.max(1, …)` の欠落（queryPlan.ts:78-80、readOnlyHandler、auditHandlers、IdbVfsBackend、recordsRepo）。
- 示唆: queryPlan が共有経路のため engine 側 1 箇所＋handler ミラーで網羅できる。
- 解: 両側クランプを queryPlan と handler に統一実装し、4 シンクを境界値テスト（-1/0/0.5/1e9）で固定。

### C6: なぜ信頼ゲートを迂回できるのか？

1. **なぜ迂回できる？** → ドメイン検証（002）、パイプラインゲート（011）、confirm トークン（018）、権限要求（042）に SW トラストシームを通らない経路が存在する。
2. **なぜ経路が増えた？** → e2e テスト、オフライン再送、UX 便宜（同一チャネルでのトークン取得、1 クリックの広い権限）のために個別にショートカットが追加された。
3. **なぜショートカットが許された？** → 「特権操作は必ず MessageRouter の sender 検証を通る」という不変条件がメッセージ型にしか適用されていない。
4. **なぜメッセージ型だけ？** → 網羅性テスト（senderTrustCoverage）の対象がメッセージ経路のみ。
5. **なぜ限定される？** → 動的 import・リプレイ・権限要求といった非メッセージ経路を「信頼境界」として認識していなかった。

**原因 → 示唆 → 解**:
- 原因: trust シームの適用範囲定義の欠如（テストはメッセージ網羅のみ）。
- 示唆: 各迂回経路には正解経路が既存（SW CHECK_DOMAIN、パイプラインゲート、パーアクショントークン、PermissionManager）。
- 解: loader 両ブランチで SW 検証を await、リプレイを force:false 化、`confirm_token` 読み取りサブタイプ廃止＋ジェスチャ時発行、`activeTab`→per-origin→明示オプトインのレベルラダー、網羅性テストを非メッセージ経路へ拡張。

### C7: なぜロックと CAS が誤用されるのか？

1. **なぜ恒久ロックする？** → `updateInProgress` の解除がループ脱出経路にのみ存在し、例外で到達不能。
2. **なぜ到達不能？** → try/finally を使っていない（制御フローで保証していない）。
3. **なぜ CAS が効かない？** → `updateFn` が `_currentDb` を無視して stale スナップショットを返す。
4. **なぜ無視する？** → コールバック契約（current を受け取りマージ結果を返す）が型で表現されていない。
5. **なぜ表現されない？** → ロック API の誤用パターン（finally 忘れ・current 無視）を検出する lint 規則/契約テストがない。

**原因 → 示唆 → 解**:
- 原因: 手続き的なロック運用（API が強制しない）。
- 示唆: 8 CAS 呼び出しサイトのうち 7 は正しく current を消費（スイープ済み）— 誤用は 1 箇所のみ。
- 解: try/finally 化、updateFn のマージ実装、ロック API 契約テスト（finally カバレッジ・current 消費検証）を追加。

### C8: なぜリソースが無限に育つのか？

1. **なぜ育つ？** → 書き込み経路に上限がなく、クリーンアップ（purge）が呼ばれていない。
2. **なぜ上限がない？** → 上限が読み取り/表示側に置かれ、書き込み境界で強制していない。
3. **なぜ書き込み側がない？** → `payloadGuard` の対象列がハードコードで、schema から導出していない。
4. **なぜ導出しない？** → schema を単一情報源とする規約が guard 実装時に適用されなかった。
5. **なぜ適用されなかった？** → 「後で列を追加する」負債がトラッキングされず、guard と schema の乖離が検出されない。

**原因 → 示唆 → 解**:
- 原因: schema（TEXT 列 7 個）と guard（3 列）の乖離、purge 制御のデッドコード化、境界での truncate 欠落。
- 示唆: 既存 precedent（1024 文字 truncate、50 タグ cap、日次 purge alarm）が存在し、配線/適用だけで解決する。
- 解: schema 駆動 guard 化、privacyChecker/pipeline 境界での truncate、`clearExpiredPages` を日次 purge alarm に配線、`local_export_*` の retention、TextRank/tagCooccurrence/tagCluster への入力 cap。

### C9: なぜリダイレクト先が検証されないのか？

1. **なぜ private IP に届く？** → `validateUrlForFilterImport` は初期 URL のみ検証し、`fetch` がリダイレクトを黙って追跡する。
2. **なぜ追跡する？** → `fetchWithTimeout` が `redirect` モードを指定せず、ブラウザ既定（follow）に委ねている。
3. **なぜ指定しない？** → リダイレクトを脅威として扱う規約が fetch ヘルパーにない。
4. **なぜ規約がない？** → 17 fetch サイトのうち攻撃者影響 URL は FETCH_URL 1 箇所のみで、汎用化する動機がなかった。
5. **なぜ動機がない？** → 「検証はホップ毎に有効」という原則が文書化されていない（初期 URL 検証で足りるという誤解）。

**原因 → 示唆 → 解**:
- 原因: `systemHandlers.ts:87` で検証済み URL の応答を無検証で追跡。
- 示唆: `redirect: 'error'` 1 行で塞げる。正規の http→https リダイレクトが壊れる場合は manual＋ホップ毎再検証に拡張。
- 解: FETCH_URL の fetch にリダイレクト方針を実装し、fetch.ts に hop-level 再検証ヘルパーを追加（将来の攻撃者影響 URL fetch 向け規約化）。

### C10: なぜログが偽造できるのか？

1. **なぜ偽造できる？** → attribution が payload の `source`、本文が外部応答（エラー body）からそのまま永続化される。
2. **なぜそのまま？** → logger のサニタイズが PII マスクのみで、制御文字/ANSI/行構造を扱わない。
3. **なぜ PII のみ？** → logger の要件定義がプライバシーに限定され、完全性（改ざん耐性・構造保全）を要件に含めていない。
4. **なぜ含めない？** → ログの消費者が dashboard ビューアで「人が読む表示」と扱われてきた。
5. **なぜそう扱う？** → ログが障害解析・監査の一次証跡であるという位置づけが明文化されていない。

**原因 → 示唆 → 解**:
- 原因: logger 境界の無害化欠落＋LOG_FORWARD の attribution 混線。
- 示唆: logger の永続化経路は単一 choke point（VULN-044 の Obsidian 2 シンクも経由）。
- 解: `_source` を sender.url 由来に、logger 境界で `\n\r`/制御文字/ANSI を無害化（LOG_FORWARD の message/details 同時カバー）。

### C11: なぜフォールバックエンジンだけ壊れているのか？

1. **なぜ更新が消える？** → update/hardDelete/toggleStar/clearAll/purge 系 6 メソッドがロックなし RMW。
2. **なぜロックなし？** → insert/insertBatch を直した際に同一パターンを他へ展開しなかった。
3. **なぜ展開しない？** → 共有ヘルパーがなく、各メソッドが load→mutate→save を手続き複製している。
4. **なぜ複製する？** → 「8 ミューテータは同一の安全性要件を持つ」という認識がコードに表現されていない。
5. **なぜ表現されない？** → フォールバックエンジンが第二級実装とみなされ、OPFS 側に比べて監査・テストが薄い。

**原因 → 示唆 → 解**:
- 原因: `storageFallback.ts` のミューテータ複製（2/8 のみ mutex 済み）。
- 示唆: `mutate(fn)` ヘルパー 1 本で 8 メソッドを直列化でき、insert 系の手書きロックも統一できる。
- 解: ヘルパー新設＋全ミューテータ経由化＋レーステスト（purge×toggleStar の実証シナリオ）。

### C12: なぜ弱い暗号経路が本番に残るのか？

1. **なぜ残る？** → 硬化版（600k iterations、strict policy、deriveHmacWrappingKey）が実装済みでも呼び出しが 0 の死蔵コード。
2. **なぜ死蔵？** → 呼び出し側が平行実装の弱い方（`utils/masterPassword`、`settingsExportImport` 独自 KDF）に配線されたまま。
3. **なぜ弱い方に配線？** → 2 実装のどちらが「正」かを示す SSOT・ドキュメントが存在しない。
4. **なぜ SSOT がない？** → iterations・ポリシー・KEK ストレージモードが各所にハードコードされている。
5. **なぜハードコード？** → 暗号定数の一元化リファクタが優先化されず、平行実装の追加がレビューで止められてこなかった。

**原因 → 示唆 → 解**:
- 原因: crypto パラメータの散在（primitives.ts:16 vs :28、2 つの masterPassword 実装、2 つの KDF 経路）。
- 示唆: 硬化版は既存・テスト済み。配線の付け替え＋弱い方の削除が本体。
- 解: `ENVELOPE_ITERATIONS` を SSOT 化して 3 経路（export/password-change/settings）に適用、KEK を session-only＋deriveHmacWrappingKey 配線、RateLimit カウンタを storage.local 永続化、get-or-create 3 流路に `encryptionKeyMutex` パターン適用、password policy を strict 版に一本化し弱い実装を削除。

### C13: なぜインポートが検証より先にリソースを使うのか？

1. **なぜ先に使う？** → パース・復号・KDF が署名検証より前に走る（settings/logs/backup の 3 系統全てで順序不統一）。
2. **なぜ不統一？** → インポート機能が別々の時期・作者で独立実装され、共通プリミティブがない。
3. **なぜプリミティブがない？** → 「ファイル取り込みは認証→上限→パース→検証の順」という規約が存在しない。
4. **なぜ規約がない？** → インポート経路の security review が機能単位でしか行われず、横断比較がされてこなかった。
5. **なぜ横断しない？** → 3 系統の差異（署名の有無、上限の有無、検証フィールド数）が一覧化されていなかった。

**原因 → 示唆 → 解**:
- 原因: `importLogsService`（署名なし・2/9 フィールド検証）、`settingsExportImport`（HMAC 後置・atob 増幅）、`encryptedBackupPanel`（上限前パース）。
- 示唆: settings 側の HMAC ゲートは正解実装として存在（fail-closed 実証済み）。
- 解: 共通インポートプリミティブ（authenticate→size-cap→parse→validate）を確立し 3 系統に適用、`validateRow` 全 9 フィールド化、YAML フロントマター エスケープ、エクスポート側署名付与。

### C14: なぜ「自己許可」構造が残るのか？

1. **なぜ自己許可が残る？** → CSPValidator / urlWhitelist が拡張自身のオリジンや ublock origin を無条件に許可リストへ入れる経路を持つ。
2. **なぜそうなった？** → 導入時は「自分のリソースは安全」という前提で書かれ、設定由来の値が同じ経路に流れることが想定外だった。
3. **なぜ想定外？** → 許可判定の入力（信頼できる定数 vs 設定由来）が型で区別されていない。
4. **なぜ区別しない？** → 許可リスト構築の契約（何を信頼するか）が文書化されていない。
5. **なぜされない？** → 現時点で exploitable ではない（Code Quality 分類）ため優先度が低く、レビューで指摘されても後回しになる。

**原因 → 示唆 → 解**:
- 原因: CSPValidator/urlWhitelist の自己許可構造、Gemini path 生補間、TSV 数式無害化欠落、models-dev スキーマ未検証、旧 href パネルの isSecureUrl 欠落（6 ハードニング）。
- 示唆: いずれも小修正。束ねて 1 PBI とし、個々に受け入れ基準を持たせる。
- 解: CSP ドメイン追加の厳格化、allowedUrls の自己許可封鎖、Gemini path エンコード、TSV 数式無害化、models-dev スキーマ検証、旧 href パネルの isSecureUrl 適用。

### C15: なぜ「効かない機能」（orphan key）が残るのか？

1. **なぜホワイトリスト追加が効かない？** → popup が orphan キー `'domainWhitelist'` に書き、正キー `domain_whitelist` の読み手がいない。
2. **なぜ誤る？** → キー名を literal で書き `StorageKeys` 定数を経由していない。
3. **なぜ literal が通る？** → キー名が string 型で、型システムが誤りを検出できない。
4. **なぜ検出できない？** → StorageKeys の union 型化（typo 不可能化）が未実施。
5. **なぜ未実施？** → キー追加時の規約（必ず StorageKeys 経由）が lint/レビューで強制されていない。

**原因 → 示唆 → 解**:
- 原因: `src/popup/pendingPages.ts` の `addDomainsOrPathsToWhitelist` が literal `'domainWhitelist'` に読み書き。
- 示唆: 修正は 2 行。実在のユーザー影響（pending 導線の沈黙）があるため C14 から分離し Wave 1 で即着手。
- 解: `StorageKeys.DOMAIN_WHITELIST` 経由に統一、既存 `domain_whitelist` 値を保持、orphan キーのデータは廃棄。テスト期待値（`main.test.ts`）も正キーに修正。

---

## トレーサビリティ（VULN-NNN → PBI）

| VULN | PBI | VULN | PBI | VULN | PBI | VULN | PBI |
|---|---|---|---|---|---|---|---|
| 001 | 02 | 015 | 03 | 029 | 07 | 044 | 10 |
| 002 | 06 | 016 | 09 | 030 | 13 | 047 | 02 |
| 003 | 04 | 017 | 05 | 034 | 13 | 048 | 05 |
| 004 | 08 | 018 | 06 | 035 | 13 | 049 | 05 |
| 005 | 04 | 019 | 10 | 036 | 13 | 050 | 04 |
| 006 | 08 | 021 | 05 | 037 | 12 | 051 | 08 |
| 007 | 08 | 022 | 11 | 038 | 12 | 052 | 12 |
| 008 | 02 | 023 | 13 | 039 | 12 | 053 | 08 |
| 009 | 04 | 024 | 08 | 040 | 12 | 054 | 03 |
| 010 | 12 | 025 | 01 | 041 | 08 | 055 | 03 |
| 011 | 06 | 026 | 01 | 042 | 06 | 056 | 04 |
| 012 | 04 | 027 | 03 | 043 | （誤検知） | | |
| 013 | 03 | 028 | 07 | | | | |

Code Quality 9件 → PBI 02（sync-target サニタイザ）、10（LOG_FORWARD 制御文字）、14（ハードニング 6 件）、15（orphan-key バグ）。
誤検知 6件（014/020/031/032/033/043）とスイープ除去 2件（045/046）は対象外。

---

## PBI作成（フェーズ4）・ファイル出力（フェーズ5）

上記順位で 15 PBI を `pbi/` に作成した（当初 14 + C14 から分離した 15）。各 PBI は `pbi-create-bdd` 準拠
（ユーザーストーリー / ビジネス価値 / 優先度RICE / BDD シナリオ / 受け入れ基準 / テスト戦略 / 実装アプローチ / 見積もり / 技術的考慮事項 / 実装者向け注記 / DoD）。

- `pbi/2026-08-29-00-backlog-vulnhunt-audit.md` — 本ファイル（候補列挙・RICE・なぜなぜ分析・トレーサビリティ）
- `pbi/2026-08-29-01-fix-regex-safety.md` ほか 14 件（ファイル名の `NN` が RICE 順位。着手は Wave 提案に従う）

**出典**: VulnHunter 2026-08-29 スキャン結果（`*_VULNHUNT_RESULTS_2026-08-29-165536/` — `.gitignore` 除外のためリポジトリ外・ローカル未保管）。
攻撃の具体（実測値・シナリオ形状）は本ファイルの「なぜなぜ分析（フェーズ3）」各節に要約済み。各 PBI のテストは受け入れ基準（BDD シナリオ）から起こす。
