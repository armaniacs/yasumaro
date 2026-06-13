#!/bin/bash
# build-wasm.sh - Rebuild wa-sqlite WASM with FTS5 support
# Requires: emscripten (brew install emscripten)
set -e

BUILD_DIR="/tmp/wa-sqlite-build-$$"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== Building wa-sqlite with FTS5 support ==="

# Clone wa-sqlite
git clone --depth 1 https://github.com/rhashimoto/wa-sqlite.git "$BUILD_DIR"

cd "$BUILD_DIR"

# Download SQLite source
mkdir -p cache/version-3.53.0
curl -LsS https://www.sqlite.org/src/tarball/version-3.53.0/sqlite.tar.gz \
  | tar -xzf - -C cache/version-3.53.0/ --strip-components=1

# Build amalgamation with all extensions (includes FTS5)
cd cache/version-3.53.0
./configure --enable-all
make sqlite3.c
cp sqlite3ext.h ../../deps/ 2>/dev/null || true
cd "$BUILD_DIR"

# Copy amalgamation to deps
mkdir -p deps/version-3.53.0
cp cache/version-3.53.0/sqlite3.c deps/version-3.53.0/
cp cache/version-3.53.0/sqlite3.h deps/version-3.53.0/
cp cache/version-3.53.0/sqlite3ext.h deps/version-3.53.0/ 2>/dev/null || true

# Download extension-functions.c
curl -LsSf 'https://www.sqlite.org/contrib/download/extension-functions.c?get=25' \
  -o cache/extension-functions.c
cp cache/extension-functions.c deps/

# Build async WASM with FTS5
make WASQLITE_EXTRA_DEFINES="-DSQLITE_ENABLE_FTS5" dist/wa-sqlite-async.mjs

# Copy to vendor
cp dist/wa-sqlite-async.wasm "$SCRIPT_DIR/"
cp dist/wa-sqlite-async.mjs "$SCRIPT_DIR/"

# Also copy to node_modules for immediate use
cp dist/wa-sqlite-async.wasm "$PROJECT_ROOT/node_modules/wa-sqlite/dist/"
cp dist/wa-sqlite-async.mjs "$PROJECT_ROOT/node_modules/wa-sqlite/dist/"

# Cleanup
rm -rf "$BUILD_DIR"

echo "=== Build complete ==="
echo "WASM size: $(wc -c < "$SCRIPT_DIR/wa-sqlite-async.wasm") bytes"
echo "Files updated:"
echo "  vendor/wa-sqlite/wa-sqlite-async.wasm"
echo "  vendor/wa-sqlite/wa-sqlite-async.mjs"
echo "  node_modules/wa-sqlite/dist/wa-sqlite-async.wasm"
echo "  node_modules/wa-sqlite/dist/wa-sqlite-async.mjs"
