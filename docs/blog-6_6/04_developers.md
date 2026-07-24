# 堅牢なデータパイプラインを構築する：Yasumaro のアーキテクチャ深化

エンジニアにとって、ツールの魅力は「何ができるか」と同じくらい「どう実装されているか」にあります。

Yasumaro は、Chrome 拡張機能という制約の多い環境で、大量のデータを安定して処理し、かつ高い保守性を維持するために、v6.4 から v6.6 にかけて大胆なアーキテクチャの刷新を行いました。

特にこだわった 3 つの設計ポイントについて解説します。

## 1. 4つのバックエンドを抽象化する「StorageBackend」パターン

Chrome 拡張機能におけるデータの保存先は、単純ではありません。
- **OPFS (Origin Private File System)**: 高速な SQLite 操作が可能だが、初期化に時間がかかる
- **IndexedDB (via wa-sqlite)**: OPFS が使えない環境でのフォールバック
- **chrome.storage.local**: 設定値などの小規模データ保存に最適
- **Noop**: テストや一時的な無効化に使用

これらを個別に扱うのではなく、`StorageBackend` という共通インターフェースの下に隠蔽しました。`SqliteEngineContext.getBackend()` が実行時に最適なバックエンドを遅延初期化して返し、上位の `RecordsRepo` や `AuditLogRepo` は、今自分がどのストレージに書き込んでいるかを意識せずにクエリを発行できます。このアダプターパターンにより、ストレージ層の変更がビジネスロジックに波及しない構造を実現しました。詳細は [ストレージアーキテクチャ guide](STORAGE_MODES.md) で解説しています。

## 2. 型安全なメッセージング：MessageHandlerRegistry

Service Worker と Content Script、および Offscreen Document 間の通信は、もともと `chrome.runtime.sendMessage` による「文字列ベースのメッセージ交換」という非常に緩いものでした。

これを改善するため、`MessageHandlerRegistry` を導入し、メッセージタイプを **Discriminated Union** で型定義しました。
- `registry.dispatch(msg.type, msg, ...)` により、型に基づいたハンドラへの動的ディスパッチを実現。
- ハンドラ側の戻り値を `void | Promise<void>` に統一し、複雑なチャネル維持ロジックを排除した fire-and-forget パターンへ移行。
- 新しいメッセージ型を追加した際、ハンドラが実装されていない場合にコンパイラが検知できる構造にしました。

## 3. ダッシュボードの「Panel 抽象化」とリアクティブな構成

18 以上の機能パネルを持つ巨大なダッシュボードを、単一の巨大なファイルで管理するのは限界がありました。

そこで、`AsyncDataPanel` / `StaticFormPanel` / `DiagnosticPanel` という 3 つの基本クラスを定義し、各パネルを独立したクラスとして実装。
- **ライフサイクル管理**: `DashboardBootstrapper` がパネルの初期化・表示・破棄を制御。
- **データバインディング**: `data-storage-key` 属性を HTML に持たせることで、設定値の読み書きを汎用的なユーティリティで自動化。
- **疎結合な通信**: `DashboardSqliteService` を介して、UI から直接 SQLite 操作を行うのではなく、メッセージングプロトコル経由して Service Worker にリクエストを飛ばす構造に統一しました。

## まとめ：複雑さを制御し、信頼性を上げる

拡張機能の開発において、Service Worker のエフェメラルな性質（いつでも終了する）と、非同期通信の複雑さは最大の敵です。

Yasumaro は、Mutex による直列化、楽観的ロック (Optimistic Lock) による不整合検知、そして徹底した型定義によるガードレールを設けることで、この複雑さを制御しています。

もし、あなたが「ブラウザ拡張で本格的なデータ管理を実装したい」と考えているなら、ぜひ Yasumaro のソースコードを読んでみてください。泥臭い試行錯誤の末に辿り着いた、実用的で堅牢なパターンが詰まっているはずです。
