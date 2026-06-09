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
