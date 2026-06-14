/**
 * Type declarations for wa-sqlite module paths used in the offscreen document.
 * The wa-sqlite package does not export types for sub-path modules like
 * `wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js`.
 */

declare module 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js' {
  import * as VFS from 'wa-sqlite/src/VFS.js';

  export class OriginPrivateFileSystemVFS extends VFS.Base {
    constructor();
    get name(): string;
    close(): Promise<void>;
  }
}

declare module 'wa-sqlite/src/examples/AccessHandlePoolVFS.js' {
  import * as VFS from 'wa-sqlite/src/VFS.js';

  export class AccessHandlePoolVFS extends VFS.Base {
    constructor(directoryPath: string);
    readonly isReady: Promise<void>;
    get name(): string;
    close(): Promise<void>;
  }
}

declare module 'wa-sqlite/dist/wa-sqlite.mjs' {
  const factory: () => Promise<Record<string, unknown> & { vfs_register?: unknown; registerVFS?: unknown }>;
  export default factory;
}

declare module 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js' {
  import * as VFS from 'wa-sqlite/src/VFS.js';

  export class IDBBatchAtomicVFS extends VFS.Base {
    constructor(idbDatabaseName?: string, options?: Record<string, unknown>);
    get name(): string;
    close(): Promise<void>;
  }
}
