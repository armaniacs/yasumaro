/**
 * args.mjs — pure argv parser for the bench CLI.
 *
 * Takes the args *after* `node cli.mjs` (i.e. `process.argv.slice(2)`),
 * never touches `process` itself so it stays unit-testable.
 *
 * @typedef {object} BenchOpts
 * @property {string} mode - first non-flag arg, defaults to 'micro'.
 * @property {string[] | null} filter - bench id subset, or null for all.
 * @property {boolean} check
 * @property {boolean} updateBaseline
 * @property {boolean} quick
 * @property {boolean} noOpen
 */

/**
 * Parse CLI args into options. Unknown args are ignored silently.
 *
 * @param {string[]} argv - args after `node cli.mjs`.
 * @returns {BenchOpts}
 */
export function parseArgs(argv) {
  /** @type {BenchOpts} */
  const opts = {
    mode: 'micro',
    filter: null,
    check: false,
    updateBaseline: false,
    quick: false,
    noOpen: false,
  };
  let modeSet = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') opts.check = true;
    else if (arg === '--update-baseline') opts.updateBaseline = true;
    else if (arg === '--quick') opts.quick = true;
    else if (arg === '--no-open') opts.noOpen = true;
    else if (arg.startsWith('--filter=')) opts.filter = arg.slice('--filter='.length).split(',');
    else if (arg === '--filter') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        opts.filter = next.split(',');
        i++;
      }
    } else if (!modeSet && !arg.startsWith('--')) {
      opts.mode = arg;
      modeSet = true;
    }
    // Anything else (unknown flags, extra positionals) is ignored.
  }
  return opts;
}
