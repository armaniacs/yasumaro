# マスターパスワード KEK 切替時の API キー再暗号化

## Status

- **Proposed**: 2026-09-28
- **Approved**: 2026-09-28
- **Implemented**: 2026-09-28

## Context

マスターパスワードの設定・変更・解除（KEK 切替）の3経路は、既存 API キー ciphertext の再暗号化を行わない。切り替え後に 6 フィールド（`obsidian_api_key`, `gemini_api_key`, `openai_api_key`, `openai_2_api_key`, `provider_api_key`, `github_pat`）が読めなくなる。旧方針（解除時に API キー暗号化データを削除する）は、削除コード自体が現行コードに存在しないため実効性がなく、データ損失だけを生む。裁定の詳細は `dev-docs/archived/pbi/2026-09-25-27-investigate-master-password-removal-reencrypt.md`。

## Decision

1. KEK 切替時は API キーを保持する。新 KEK（設定・変更時は新パスワード由来、解除時は匿名 secret 由来）へ再暗号化する。
2. 復号不能な項目が1件でもあれば、認証メタデータと元 ciphertext に触れず処理を中止し、空文字で上書きしない。中止時は復号不能の項目名のみを UI に示す（値・復号結果・認証情報は出さない）。
3. 確定手順は lock 取得 → 両配置（nested `settings` blob / legacy scattered key）から読取 → 旧 KEK で全件復号 → 新 KEK で再暗号化 → delta write → 新 KEK で read back 確認 → 認証メタデータ更新 → キャッシュと `IS_LOCKED` 更新。確認が通るまで認証メタデータに触れない。lock は settings トランザクションの CAS リトライで直列化し（nested 書き込み）、試行検出の冪等性により再実行は収束する。UI の二重実行ガードと合わせ、タブ跨ぎの同時実行は残存リスクとして受容する。
4. 再開規則: 項目ごとに旧 KEK → 新 KEK の順で復号を試み、新で読めれば移行済みとして skip する（試行検出）。進捗マーカーは使わない。設定・変更時は新 salt を `master_password_pending_salt` に先行保存する。中断時はアンカーを残し、次回実行で同じ新 KEK を再導出して収束させる。認証メタデータが当該 salt を担った場合にのみアンカーを削除する（salt 単体では鍵を導出できないため認証状態は変わらない）。
5. `settings` への書き込みは delta のみとし、スナップショット全量を書き戻さない。`master_password_pending_salt` は settings blob へ移行しない（top-level 固定）。

## Consequences

### Positive

- KEK 切替のどの操作でも API キーが保持される。
- 中途終了（Service Worker 終了）後に再実行すると同じ値へ到達する。認証メタデータ未更新＝未完了として再開できる。
- 再暗号化・確認・メタデータ更新が1経路に集約され、監査とテストの対象が単一になる。

### Negative

- 混在状態（nested 新 KEK / scattered 旧 KEK 等）が一時的に存在し得る。その間の読みは `unrecoverable` 扱いになる（ciphertext は温存され、再実行で収束する）。
- 設定・変更時は PBKDF2 600k を条件付きで最大2回（旧 KEK 解決 + 新 KEK 導出）実行する。API キー ciphertext が無い場合はどちらも実行しない。

### Residual risks

- 匿名 KEK は拡張機能内の IndexedDB にあるため、拡張機能内部への侵入者は復号できる（`chrome.storage.local` 単体漏洩では復号不可）。
- 解除後に旧パスワードを知る者が storage の ciphertext コピーを事前に取得していた場合の保護はない（通常の暗号化保管の前提）。
- 同一マシン上の別タブが同時に KEK 切替を走らせた場合の直列化はしない（UI の二重実行ガードと CAS リトライ + 試行検出の冪等性に依存する）。
