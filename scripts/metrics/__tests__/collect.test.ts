import { describe, it, expect } from 'vitest';
import {
  countLines,
  countTestCalls,
  countFunctionDefinitions,
  countDependencies,
  listSourceFiles,
  isTestFile,
  collectMetricsForRef,
} from '../collect.mjs';

describe('countLines', () => {
  it('counts non-empty file content as line count', () => {
    const content = 'line1\nline2\nline3\n';
    expect(countLines(content)).toBe(3);
  });

  it('returns 0 for empty content', () => {
    expect(countLines('')).toBe(0);
  });

  it('counts a single line without trailing newline', () => {
    expect(countLines('const x = 1;')).toBe(1);
  });
});

describe('countTestCalls', () => {
  it('counts it( and test( calls', () => {
    const content = `
      describe('foo', () => {
        it('does a thing', () => {});
        test('does another thing', () => {});
        it('does a third thing', () => {});
      });
    `;
    expect(countTestCalls(content)).toBe(3);
  });

  it('returns 0 when there are no test calls', () => {
    expect(countTestCalls('const x = 1;')).toBe(0);
  });

  it('does not count it( inside identifiers like "unit("', () => {
    const content = 'function unit() { return 1; }';
    expect(countTestCalls(content)).toBe(0);
  });
});

describe('countFunctionDefinitions', () => {
  it('counts function declarations', () => {
    const content = 'function foo() {}\nfunction bar() {}';
    expect(countFunctionDefinitions(content)).toBe(2);
  });

  it('counts arrow functions assigned to a const', () => {
    const content = 'const foo = () => {};\nconst bar = (x) => x + 1;';
    expect(countFunctionDefinitions(content)).toBe(2);
  });

  it('counts async function declarations', () => {
    const content = 'async function foo() {}';
    expect(countFunctionDefinitions(content)).toBe(1);
  });

  it('returns 0 for content with no functions', () => {
    expect(countFunctionDefinitions('const x = 1;')).toBe(0);
  });
});

describe('countDependencies', () => {
  it('sums dependencies and devDependencies counts', () => {
    const packageJson = JSON.stringify({
      dependencies: { a: '1.0.0', b: '2.0.0' },
      devDependencies: { c: '3.0.0' },
    });
    expect(countDependencies(packageJson)).toBe(3);
  });

  it('returns 0 when both fields are missing', () => {
    const packageJson = JSON.stringify({ name: 'foo' });
    expect(countDependencies(packageJson)).toBe(0);
  });

  it('handles only dependencies present', () => {
    const packageJson = JSON.stringify({ dependencies: { a: '1.0.0' } });
    expect(countDependencies(packageJson)).toBe(1);
  });
});

describe('listSourceFiles', () => {
  it('filters to src/ and entrypoints/ .ts/.tsx/.js files only', () => {
    const allFiles = [
      'src/foo.ts',
      'src/foo.test.ts',
      'entrypoints/background/index.ts',
      'README.md',
      'docs/design.md',
      'src/bar.tsx',
      'scripts/build.mjs',
    ];
    const result = listSourceFiles(allFiles);
    expect(result).toEqual([
      'src/foo.ts',
      'src/foo.test.ts',
      'entrypoints/background/index.ts',
      'src/bar.tsx',
    ]);
  });

  it('returns an empty array when no files match', () => {
    expect(listSourceFiles(['README.md', 'package.json'])).toEqual([]);
  });
});

describe('isTestFile', () => {
  it('recognizes .test.ts and .spec.ts files', () => {
    expect(isTestFile('src/foo.test.ts')).toBe(true);
    expect(isTestFile('src/foo.spec.ts')).toBe(true);
    expect(isTestFile('src/foo.ts')).toBe(false);
  });
});

describe('collectMetricsForRef', () => {
  it('aggregates metrics across files using injected git accessors', async () => {
    const fakeGit = {
      listFiles: () => ['src/foo.ts', 'src/foo.test.ts', 'entrypoints/bg.ts', 'package.json'],
      readFile: (ref, path) => {
        const files = {
          'src/foo.ts': 'function foo() {}\nconst bar = () => 1;\n',
          'src/foo.test.ts': "it('works', () => {});\nit('also works', () => {});\n",
          'entrypoints/bg.ts': 'export const x = 1;\n',
          'package.json': JSON.stringify({
            version: '1.2.3',
            dependencies: { a: '1.0.0' },
            devDependencies: { b: '1.0.0', c: '1.0.0' },
          }),
        };
        return files[path];
      },
      getTagDate: () => '2026-01-01T00:00:00+09:00',
    };

    const result = await collectMetricsForRef('v1.2.3', fakeGit);

    expect(result).toEqual({
      version: '1.2.3',
      tag: 'v1.2.3',
      date: '2026-01-01T00:00:00+09:00',
      linesOfCode: 5,
      fileCount: 3,
      testCount: 2,
      functionCount: 2,
      dependencyCount: 3,
    });
  });

  it('skips files that fail to read instead of throwing', async () => {
    const fakeGit = {
      listFiles: () => ['src/foo.ts', 'src/missing.ts'],
      readFile: (ref, path) => {
        if (path === 'src/missing.ts') return undefined;
        if (path === 'package.json') return JSON.stringify({ version: '1.0.0' });
        return 'const x = 1;\n';
      },
      getTagDate: () => '2026-01-01T00:00:00+09:00',
    };

    const result = await collectMetricsForRef('v1.0.0', fakeGit);
    expect(result.fileCount).toBe(1);
    expect(result.linesOfCode).toBe(1);
  });
});
