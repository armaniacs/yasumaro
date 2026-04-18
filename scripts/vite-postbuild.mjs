#!/usr/bin/env node

/**
 * Post-build script for Vite
 * Copies static files from src to dist directories
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('Running post-build...');

let hasError = false;

// Copy static files to dist directories
const dirs = ['popup', 'dashboard', 'privacy'];
for (const dir of dirs) {
    const src = path.join(rootDir, 'dist/src', dir);
    const dest = path.join(rootDir, 'dist', dir);
    fs.mkdirSync(dest, { recursive: true });
    try {
        const files = fs.readdirSync(src);
        files.filter(f => f.endsWith('.html') || f.endsWith('.css'))
             .forEach(f => fs.copyFileSync(path.join(src, f), path.join(dest, f)));
    } catch (e) {
        console.error(`Error copying files from ${src}:`, e.message);
        hasError = true;
    }
}

// Copy manifest and other static assets (must-succeed files)
const requiredAssets = ['manifest.json', '_locales'];
for (const s of requiredAssets) {
    try {
        const p = path.join(rootDir, s);
        if (fs.statSync(p).isDirectory()) {
            fs.cpSync(p, path.join(rootDir, 'dist', s), { recursive: true });
        } else {
            fs.copyFileSync(p, path.join(rootDir, 'dist', s));
        }
        console.log(`Copied ${s}`);
    } catch (e) {
        console.error(`Failed to copy required asset ${s}:`, e.message);
        process.exit(1);
    }
}

// Copy optional static assets
const optionalAssets = ['icons', 'data'];
for (const s of optionalAssets) {
    try {
        const p = path.join(rootDir, s);
        if (fs.existsSync(p)) {
            if (fs.statSync(p).isDirectory()) {
                fs.cpSync(p, path.join(rootDir, 'dist', s), { recursive: true });
            } else {
                fs.copyFileSync(p, path.join(rootDir, 'dist', s));
            }
        }
    } catch (e) {
        console.warn(`Warning: failed to copy ${s}:`, e.message);
    }
}

// Copy CSS files
try {
    fs.copyFileSync(path.join(rootDir, 'src/popup/styles.css'), path.join(rootDir, 'dist/popup/styles.css'));
} catch (e) {
    console.error('Failed to copy popup/styles.css:', e.message);
    hasError = true;
}

try {
    fs.cpSync(path.join(rootDir, 'src/dashboard/dashboard.css'), path.join(rootDir, 'dist/dashboard/dashboard.css'));
    fs.cpSync(path.join(rootDir, 'src/dashboard/models-dev-dialog.css'), path.join(rootDir, 'dist/dashboard/models-dev-dialog.css'));
} catch (e) {
    console.error('Failed to copy dashboard CSS:', e.message);
    hasError = true;
}

try {
    fs.copyFileSync(path.join(rootDir, 'src/privacy/privacy.css'), path.join(rootDir, 'dist/privacy/privacy.css'));
} catch (e) {
    console.error('Failed to copy privacy.css:', e.message);
    hasError = true;
}

if (hasError) {
    console.error('Post-build completed with errors');
    process.exit(1);
}

console.log('Post-build complete');
