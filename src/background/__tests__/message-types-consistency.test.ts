/**
 * message-types-consistency.test.ts
 *
 * ExtensionMessage / VALID_MESSAGE_TYPES / ResponseForType の整合性を守るテスト。
 *
 * PBI 2026-08-08-04:
 * 以前はチェック対象のメッセージ型を**このファイル内に手書きで複製**していた。
 * そのため新しい型（LOG_FORWARD）が追加されてもリストが更新されず、
 * 「整合性を守るはずのテストが最新の型を見落とす」状態になっていた。
 *
 * 現在は VALID_MESSAGE_TYPES を唯一の真実の源として、そこからの導出と
 * 型レベルの網羅性チェック（never 判定）で担保する。手書きリストは持たない。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ExtensionMessage } from '../messageTypes.js';
import { VALID_MESSAGE_TYPES, CONTENT_SCRIPT_ONLY_TYPES, NO_PAYLOAD_TYPES } from '../messageTypes.js';

type ValidType = ExtensionMessage['type'];

/**
 * 型レベルの網羅性チェック。
 *
 * ExtensionMessage の型のうち VALID_MESSAGE_TYPES に無いものがあれば
 * Missing が never にならず、`npm run type-check` がエラーになる。
 * ただし vitest は実行時に型を消すため、**このチェックだけでは
 * テストは失敗しない**。実行時の担保は下の「ソースから導出」テストで行う。
 */
type Missing = Exclude<ValidType, (typeof VALID_MESSAGE_TYPES)[number]>;
const _noMissingTypes: Missing extends never ? true : never = true;

type Extra = Exclude<(typeof VALID_MESSAGE_TYPES)[number], ValidType>;
const _noExtraTypes: Extra extends never ? true : never = true;

const messageTypesSource = readFileSync(
    fileURLToPath(new URL('../messageTypes.ts', import.meta.url)),
    'utf-8',
);

/**
 * ExtensionMessage union のメンバー名をソースから読み取る。
 *
 * 手書きのリストを持たないことが目的。型情報は実行時に消えるため、
 * ソーステキストから導出して VALID_MESSAGE_TYPES と突き合わせる。
 */
function unionMemberTypeNames(): string[] {
    const unionBlock = messageTypesSource.match(
        /export type ExtensionMessage = \(([\s\S]*?)\) & \{/,
    );
    if (!unionBlock) throw new Error('ExtensionMessage union not found in messageTypes.ts');

    const memberInterfaceNames = [...unionBlock[1]!.matchAll(/\|\s*(\w+)/g)].map(m => m[1]!);
    return memberInterfaceNames.map(interfaceName => {
        // 各メンバー interface の `type: 'NAME'` を引く
        const literal = messageTypesSource.match(
            new RegExp(`(?:type|interface)\\s+${interfaceName}\\b[\\s\\S]*?type:\\s*'([A-Z_]+)'`),
        );
        if (!literal) throw new Error(`type literal not found for ${interfaceName}`);
        return literal[1]!;
    });
}

describe('Message Type Consistency', () => {
    test('ExtensionMessage の全メンバーが VALID_MESSAGE_TYPES に含まれる', () => {
        // 手書きリストではなくソースから導出するため、新しい型を追加して
        // VALID_MESSAGE_TYPES への追加を忘れると、このテストが失敗する。
        const declared = unionMemberTypeNames();
        expect(declared.length).toBeGreaterThan(0);
        for (const type of declared) {
            expect(VALID_MESSAGE_TYPES).toContain(type);
        }
    });

    test('VALID_MESSAGE_TYPES に ExtensionMessage 外の型が混ざっていない', () => {
        const declared = new Set(unionMemberTypeNames());
        for (const type of VALID_MESSAGE_TYPES) {
            expect(declared.has(type)).toBe(true);
        }
    });

    test('型レベルの網羅性チェックが成立している', () => {
        expect(_noMissingTypes).toBe(true);
        expect(_noExtraTypes).toBe(true);
    });

    test('VALID_MESSAGE_TYPES に重複が無い', () => {
        const unique = new Set<string>(VALID_MESSAGE_TYPES);
        expect(unique.size).toBe(VALID_MESSAGE_TYPES.length);
    });

    test('VALID_VISIT is in CONTENT_SCRIPT_ONLY_TYPES', () => {
        expect(CONTENT_SCRIPT_ONLY_TYPES).toContain('VALID_VISIT');
    });

    test('NO_PAYLOAD_TYPES are a subset of VALID_MESSAGE_TYPES', () => {
        for (const type of NO_PAYLOAD_TYPES) {
            expect(VALID_MESSAGE_TYPES).toContain(type);
        }
    });

    test('CONTENT_SCRIPT_ONLY_TYPES are a subset of VALID_MESSAGE_TYPES', () => {
        for (const type of CONTENT_SCRIPT_ONLY_TYPES) {
            expect(VALID_MESSAGE_TYPES).toContain(type);
        }
    });
});
