/**
 * migrationService-opfs.test.ts
 * Tests for PBI-25: OPFS Recovery Auto-Migration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MigrationService } from '../migrationService.js';

// Mock chrome.storage.local
const storageMock: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
    storage: {
        local: {
            get: vi.fn(async (key: string | string[]) => {
                if (Array.isArray(key)) {
                    const result: Record<string, unknown> = {};
                    for (const k of key) {
                        result[k] = storageMock[k];
                    }
                    return result;
                }
                return { [key]: storageMock[key] };
            }),
            set: vi.fn(async (items: Record<string, unknown>) => {
                Object.assign(storageMock, items);
            }),
            remove: vi.fn(async (key: string | string[]) => {
                const keys = Array.isArray(key) ? key : [key];
                for (const k of keys) {
                    delete storageMock[k];
                }
            }),
        },
    },
});

vi.mock('../../utils/logger.js', () => ({
    addLog: vi.fn(),
    LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}));

describe('PBI-25: OPFS Recovery Migration', () => {
    let migrationService: MigrationService;
    let mockSqliteClient: {
        insertBatch: ReturnType<typeof vi.fn>;
        getStatus: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Clear storage mock
        for (const key of Object.keys(storageMock)) {
            delete storageMock[key];
        }

        mockSqliteClient = {
            insertBatch: vi.fn().mockResolvedValue({ count: 0 }),
            getStatus: vi.fn().mockResolvedValue({ fallback: false, initialized: true }),
        };

        migrationService = new MigrationService(mockSqliteClient as any);
    });

    describe('needsOpfsRecoveryMigration', () => {
        it('should return true when all conditions are met', async () => {
            storageMock['opfs_fallback_mode'] = true;
            storageMock['FALLBACK_STORAGE_DATA'] = {
                records: [{ url: 'https://example.com', created_at: 123 }],
            };

            const result = await migrationService.needsOpfsRecoveryMigration();
            expect(result).toBe(true);
        });

        it('should return false when not in fallback mode', async () => {
            // opfs_fallback_mode is not set
            storageMock['FALLBACK_STORAGE_DATA'] = {
                records: [{ url: 'https://example.com', created_at: 123 }],
            };

            const result = await migrationService.needsOpfsRecoveryMigration();
            expect(result).toBe(false);
        });

        it('should return false when SQLite is still in fallback mode', async () => {
            storageMock['opfs_fallback_mode'] = true;
            mockSqliteClient.getStatus.mockResolvedValue({ fallback: true });

            const result = await migrationService.needsOpfsRecoveryMigration();
            expect(result).toBe(false);
        });

        it('should return false when no fallback data exists', async () => {
            storageMock['opfs_fallback_mode'] = true;
            // FALLBACK_STORAGE_DATA is not set

            const result = await migrationService.needsOpfsRecoveryMigration();
            expect(result).toBe(false);
        });

        it('should return false when fallback data is empty', async () => {
            storageMock['opfs_fallback_mode'] = true;
            storageMock['FALLBACK_STORAGE_DATA'] = { records: [] };

            const result = await migrationService.needsOpfsRecoveryMigration();
            expect(result).toBe(false);
        });

        it('should return false on error (fail-safe)', async () => {
            storageMock['opfs_fallback_mode'] = true;
            mockSqliteClient.getStatus.mockRejectedValue(new Error('Test error'));

            const result = await migrationService.needsOpfsRecoveryMigration();
            expect(result).toBe(false);
        });
    });

    describe('migrateOpfsRecovery', () => {
        it('should migrate records and clear flag on success', async () => {
            storageMock['opfs_fallback_mode'] = true;
            storageMock['FALLBACK_STORAGE_DATA'] = {
                records: [
                    { url: 'https://example.com', created_at: 123, title: 'Test' },
                    { url: 'https://test.com', created_at: 456, title: 'Test 2' },
                ],
            };

            mockSqliteClient.insertBatch.mockResolvedValue({ count: 2 });

            const result = await migrationService.migrateOpfsRecovery();

            expect(result.success).toBe(true);
            expect(result.migrated).toBe(2);
            expect(storageMock['opfs_fallback_mode']).toBeUndefined();
            expect(storageMock['FALLBACK_STORAGE_DATA']).toBeUndefined();
        });

        it('should handle empty fallback data', async () => {
            storageMock['opfs_fallback_mode'] = true;
            storageMock['FALLBACK_STORAGE_DATA'] = { records: [] };

            const result = await migrationService.migrateOpfsRecovery();

            expect(result.success).toBe(true);
            expect(result.migrated).toBe(0);
        });

        it('should preserve flag on insertBatch failure', async () => {
            storageMock['opfs_fallback_mode'] = true;
            storageMock['FALLBACK_STORAGE_DATA'] = {
                records: [{ url: 'https://example.com', created_at: 123 }],
            };

            mockSqliteClient.insertBatch.mockResolvedValue(null);

            const result = await migrationService.migrateOpfsRecovery();

            expect(result.success).toBe(false);
            expect(storageMock['opfs_fallback_mode']).toBe(true); // Flag preserved
        });

        it('should handle corrupted data gracefully', async () => {
            storageMock['opfs_fallback_mode'] = true;
            storageMock['FALLBACK_STORAGE_DATA'] = 'invalid';

            const result = await migrationService.migrateOpfsRecovery();

            expect(result.success).toBe(true);
            expect(result.migrated).toBe(0);
        });

        it('should preserve data integrity during migration', async () => {
            storageMock['opfs_fallback_mode'] = true;
            storageMock['FALLBACK_STORAGE_DATA'] = {
                records: [
                    {
                        url: 'https://example.com',
                        title: 'Test Title',
                        summary: 'Test Summary',
                        tags: 'tag1, tag2',
                        created_at: 1234567890,
                        is_starred: 1,
                    },
                ],
            };

            mockSqliteClient.insertBatch.mockImplementation((batch) => {
                expect(batch[0].url).toBe('https://example.com');
                expect(batch[0].title).toBe('Test Title');
                expect(batch[0].tags).toBe('tag1, tag2');
                expect(batch[0].is_starred).toBe(1);
                return Promise.resolve({ count: 1 });
            });

            const result = await migrationService.migrateOpfsRecovery();

            expect(result.success).toBe(true);
            expect(result.migrated).toBe(1);
        });

        it('should handle partial batch failure (batch 2 of 2 fails)', async () => {
            storageMock['opfs_fallback_mode'] = true;
            const records = Array.from({ length: 150 }, (_, i) => ({
                url: `https://example${i}.com`,
                created_at: i,
            }));
            storageMock['FALLBACK_STORAGE_DATA'] = { records };

            let callCount = 0;
            mockSqliteClient.insertBatch.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({ count: 100 });
                }
                return Promise.resolve(null);
            });

            const result = await migrationService.migrateOpfsRecovery();

            expect(result.success).toBe(false);
            expect(result.migrated).toBe(100);
            expect(storageMock['opfs_fallback_mode']).toBe(true);
        });

        it('should remove data before clearing flag (atomicity fix: data-first order)', async () => {
            storageMock['opfs_fallback_mode'] = true;
            storageMock['FALLBACK_STORAGE_DATA'] = {
                records: [{ url: 'https://example.com', created_at: 123 }],
            };
            mockSqliteClient.insertBatch.mockResolvedValue({ count: 1 });

            const removeSpy = vi.spyOn(chrome.storage.local, 'remove');

            await migrationService.migrateOpfsRecovery();

            const removeCalls = removeSpy.mock.calls.map(c => c[0]);
            const flagIndex = removeCalls.indexOf('opfs_fallback_mode');
            const dataIndex = removeCalls.indexOf('FALLBACK_STORAGE_DATA');

            expect(flagIndex).toBeGreaterThanOrEqual(0);
            expect(dataIndex).toBeGreaterThanOrEqual(0);
            expect(dataIndex).toBeLessThan(flagIndex);

            removeSpy.mockRestore();
        });

        it('should leave both flag and data when remove() throws during flag clearance', async () => {
            storageMock['opfs_fallback_mode'] = true;
            storageMock['FALLBACK_STORAGE_DATA'] = {
                records: [{ url: 'https://example.com', created_at: 123 }],
            };
            mockSqliteClient.insertBatch.mockResolvedValue({ count: 1 });

            const originalRemove = chrome.storage.local.remove;
            vi.spyOn(chrome.storage.local, 'remove').mockImplementationOnce(async () => {
                throw new Error('Simulated crash during flag clearance');
            });

            const result = await migrationService.migrateOpfsRecovery();

            expect(result.success).toBe(false);
            expect(storageMock['opfs_fallback_mode']).toBe(true);
            expect(storageMock['FALLBACK_STORAGE_DATA']).toBeDefined();

            vi.restoreAllMocks();
        });
    });
});
