import { describe, it, expect } from 'vitest';
import { countLines, countTestCalls, countFunctionDefinitions, countDependencies } from '../collect.mjs';

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
