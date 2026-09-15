/**
 * archiveSessionStore.ts (PBI 2026-09-15-09)
 *
 * アーカイブの staging セッションライフサイクルを状態機械として表現する深い
 * module。かつてこの状態は archivePanel の mount クロージャ内の nullable 変数
 * （sessionStaging）+ dirty フラグに分散し、遷移の順序制約（open 後に
 * sessionStaging を設定してから一覧を描画する等）がコメントと防御的 null
 * チェックでしか表現されていなかった。
 *
 * 遷移表:
 *
 *   idle --stageSession/reopen--> staged/open（session 名を保持）
 *   staged --markOpen--> open（セッションビューアに引き渡し）
 *   open --markDirty--> dirty（レコード更新が着地）
 *   dirty --markSaved--> open（保存で dirty 解消）
 *   任意 --clear--> idle（close / cleanup）
 *
 * 不正遷移（idle からの markDirty 等）は警告ログ付き no-op — 呼び出し側の
 * 防御的 null チェックの置換先であり、状態の整合はここで担保される。
 *
 * 注意: 同名 staging を使う「作成→ダウンロード→クリーンアップ」フローは
 * 線形で分岐を持たないため、この状態機械の対象外（パネル内のローカル変数
 * のまま）。
 */

import { logWarn, ErrorCode } from '../../../utils/logger.js';

export type ArchiveLifecycleState = 'idle' | 'staged' | 'open' | 'dirty';

export interface ArchiveSessionStore {
    getState(): ArchiveLifecycleState;
    getSessionName(): string | null;
    isDirty(): boolean;
    /** idle → staged: staging ファイルが存在するがセッションは未オープン。 */
    stageSession(name: string): void;
    /** staged → open: セッションビューアが staging を引き継ぐ。 */
    markOpen(): void;
    /** 再接続: offscreen が既に open しているセッションを復元する。 */
    reopen(name: string, isDirty: boolean): void;
    /** open → dirty: レコード更新が着地。 */
    markDirty(): void;
    /** dirty → open: 保存が完了。 */
    markSaved(): void;
    /** 任意 → idle: セッション close / staging cleanup。 */
    clear(): void;
}

function logIllegalTransition(from: ArchiveLifecycleState, event: string): void {
    logWarn(`ArchiveSessionStore: illegal transition '${event}' from '${from}' — ignored`);
}

export function createArchiveSessionStore(): ArchiveSessionStore {
    let state: ArchiveLifecycleState = 'idle';
    let sessionName: string | null = null;
    let dirty = false;

    return {
        getState(): ArchiveLifecycleState {
            return state;
        },

        getSessionName(): string | null {
            return sessionName;
        },

        isDirty(): boolean {
            return dirty;
        },

        stageSession(name: string): void {
            sessionName = name;
            dirty = false;
            state = 'staged';
        },

        markOpen(): void {
            if (state !== 'staged' && state !== 'dirty') {
                logIllegalTransition(state, 'markOpen');
                return;
            }
            state = 'open';
        },

        reopen(name: string, isDirty: boolean): void {
            sessionName = name;
            dirty = isDirty;
            state = isDirty ? 'dirty' : 'open';
        },

        markDirty(): void {
            if (state !== 'open') {
                logIllegalTransition(state, 'markDirty');
                return;
            }
            dirty = true;
            state = 'dirty';
        },

        markSaved(): void {
            if (state !== 'dirty') {
                logIllegalTransition(state, 'markSaved');
                return;
            }
            dirty = false;
            state = 'open';
        },

        clear(): void {
            sessionName = null;
            dirty = false;
            state = 'idle';
        },
    };
}

void logIllegalTransition;
