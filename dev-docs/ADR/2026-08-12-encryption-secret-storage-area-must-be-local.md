# ADR: 暗号化秘密値（ENCRYPTION_SECRET）は chrome.storage.local に保存する

## ステータス

採用済み。2026-08-12 に発生した実インシデント（拡張機能アップデート後の全APIキー消失）を受けて、`chrome.storage.session` への移行を撤回し `chrome.storage.local` に戻した。

## 背景

commit `8b1d82b6`（2026-08-12）で、APIキー暗号化に使う秘密値 `ENCRYPTION_SECRET` の保存先を `chrome.storage.local`（永続ストレージ）から `chrome.storage.session` に変更した。意図は「local storage には平文の秘密を保持しない」というセキュリティ強化で、XSS等でlocal storageの内容が窃取された場合の耐性を高めることが目的だった。

同日中に、この変更を含むバージョンへアップデートしたユーザーから「Obsidian・AIプロバイダのAPIキーが保存されていたはずなのに消えている」という報告があり、原因調査の結果この変更が直接の原因と判明した。

## 何が起きたか

`chrome.storage.session` は Chrome Extensions API の仕様上、**拡張機能のアップデート時にクリアされる**（`chrome.storage.session` のライフサイクルは拡張機能プロセスの再起動に紐づき、アップデートは新しいコードでのプロセス再起動を意味するため）。

`getOrCreateEncryptionKey()` は「secretが存在しなければ新規生成する」というロジックを持つため、アップデート後に `chrome.storage.session` が空になると：

1. 秘密値が失われたことを「初回起動」と誤認識する
2. 新しいランダム秘密値を自動生成する
3. 既存の暗号化済みAPIキー（PBKDF2導出キーで暗号化されたObsidian/AIプロバイダのトークン）は、新しい秘密値では復号できない
4. ユーザーからは「APIキーが消えた」ように見える

この変更を含むバージョンは移行コード（旧 `chrome.storage.local` の秘密値を `chrome.storage.session` へ一度だけ移動し、local側を削除する）も持っていたため、**一度でもこの移行が走ると local 側の秘密値は失われ、後戻りできなかった**。

## 決定

`ENCRYPTION_SECRET` は `chrome.storage.local` に保存する。`chrome.storage.session` への移行は撤回する。

併せて、既にこの問題の影響を受けた（＝ `chrome.storage.session` に秘密値が移動済みだが、まだアップデートでクリアされていない）ユーザー向けに、`getOrCreateEncryptionKey()` 内で「local に無ければ session を確認し、あれば local へ復元する」救済マイグレーションを実装した（`src/utils/storage/encryptionSession.ts`）。ただし、既にアップデートを跨いで `chrome.storage.session` がクリアされてしまったユーザーはこの救済で復旧できず、APIキーの再入力が必要になる。

## この意思決定の一般原則（今後の設計判断に適用する）

**Chrome拡張機能でユーザーの永続データ（設定・認証情報・暗号鍵材料など、消えるとユーザー体験を損なうデータ）を扱う場合、`chrome.storage.session` を選択してはならない。** `chrome.storage.session` は「タブ間で共有したいが、拡張機能プロセス終了で消えて構わない一時データ」専用であり、それ以外の用途には常に `chrome.storage.local`（または将来的な同期要件があれば `chrome.storage.sync`）を使う。

**セキュリティ強化とユーザビリティはトレードオフとして両立を検討し、片方だけを最適化しない。** 「local storageに平文を置かない」というセキュリティ上の意図は妥当だが、その手段として「アップデートで消えるstorage areaに移す」を選んだ結果、意図した脅威（XSS等によるlocal storage窃取）よりもはるかに高い確率で発生する「通常のアップデート」によってデータロスというより深刻な被害を生んだ。**セキュリティ対策を導入する際は、その対策が意図しない形で可用性・データ整合性を損なわないか、通常運用パス（アップデート、再起動、複数タブ）を必ず検証する。**

**ストレージ層の変更は、実ブラウザでのアップデートシナリオ（`chrome://extensions` での新バージョン読み込み、Web Store経由の自動更新）を検証してからリリースする。** 単体テストのモックだけでは `chrome.storage.session` のクリアタイミングという実行環境依存の挙動を検出できない。

## 再発防止

- `src/utils/storage/encryptionSession.ts` に、なぜ `chrome.storage.local` を使うかを明記したコメントを残した（本ADRへの参照を含む）
- `src/utils/__tests__/storage-security.test.ts` に、secretがlocalへ永続化されること・SW再起動後も同じsecretが再利用されること・過去バージョンでsessionへ移動済みの秘密がlocalへ救済されることの3テストを追加した
- 今後、同様に `chrome.storage.session` への保存を検討する変更がある場合は、対象データが「拡張機能アップデートで失われても実害がないか」を必ず明示的に確認する
