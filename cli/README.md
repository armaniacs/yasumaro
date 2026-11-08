# yasumaro (Rust CLI)

> **Development status:** this CLI is under active development. Commands,
> flags, output formats, and exit-code semantics may change without notice
> until the first stable release. Do not rely on its interface in scripts
> that require long-term stability.

Read-only CLI for exported Yasumaro history databases. It never writes to
the database (read-only open); the only write it performs is appending REPL
history to the history file described below.

This is a Rust port of the JS reference implementation under
`tools/yasumaro-cli/` (branch `feature/yasumaro-cli`). The JS version is the
specification; this crate coexists with it and does not replace it.

## Getting a history database (.db)

The CLI does not collect history itself. Prepare a `.db` file first:

- Export it from the Dashboard via Diagnostics / Export
- Or download the `.db` from the archive panel

Pass the file with `--db`, or store it in the config file below.

## Installing the `yasumaro` command

```sh
cargo install --path cli
yasumaro --help
```

After the crate is published on crates.io, it can be installed directly:

```sh
cargo install yasumaro
```

## Config file (config.toml)

The default path is `~/.config/yasumaro/config.toml`. It honors
`$XDG_CONFIG_HOME` (`$XDG_CONFIG_HOME/yasumaro/config.toml`) and
`$YASUMARO_CONFIG` (an explicit path wins over both).

Example:

```toml
db_path = "~/yasumaro.db"
limit = 50
history_file = "~/.yasumaro_history"
history_max_lines = 500
```

- `db_path`: database path used by default
- `limit`: row count when `--limit` is omitted (default 50)
- `history_file`: REPL history file (default `~/.yasumaro_history`).
  An empty string disables history saving
- `history_max_lines`: max history lines kept (default 500); older lines
  are trimmed on load and on save

Unknown keys are ignored. A broken TOML file is a usage error (exit 2).

Database resolution order:

1. `--db PATH`
2. Environment variable `YASUMARO_DB`
3. Config file `db_path`
4. `./yasumaro.db`

Show the effective config with:

```sh
yasumaro config
yasumaro config --json
```

## Usage

```sh
# Full-text search (FTS when the browsing_logs_fts table exists,
# LIKE fallback otherwise; queries under 3 chars always use LIKE)
yasumaro search --query "..." --limit 20
yasumaro search --query " design " --domain example.com --tag work --starred

# Listing with date filters
yasumaro list --from 2026-01-01 --to 2026-01-31 --limit 50
yasumaro list --domain example.com --starred

# One record
yasumaro show --id 123

# Statistics
yasumaro stats

# Export (json / csv / md)
yasumaro export --format json --query "..." --out ./out.json
yasumaro export --format csv --out ./out.csv
yasumaro export --format md --out ./out.md

# Also send the result to the clipboard
yasumaro search --query "TODO" --copy
```

Common flags: `--db PATH` `--json` `--copy` `--limit N` `--offset N`
`--help` `--version`

`--copy` uses `pbcopy` (macOS), `xclip` then `xsel` (Linux), or `clip`
(Windows). With `--json`, the JSON string is what gets copied. When the
helper is missing, the output is still printed and the command exits 3.

### Interactive shell (REPL)

Start with no arguments:

```sh
yasumaro
```

```text
yasumaro> search ...
yasumaro> search --query "..." --limit 10
yasumaro> show --id 123
yasumaro> stats
yasumaro> help
yasumaro> exit
```

- `search` accepts a shorthand: `search ...` means `--query "..."`. The
  shorthand takes plain words only; to combine flags, use the explicit
  form (`search --query "..." --limit 10`) or the non-interactive
  command (`yasumaro search --query ... --limit 10`)
- `exit`, `.exit`, `quit`, or Ctrl+D leaves the shell
- Ctrl+R is reverse-i-search through history (native readline support)
- History lives in `history_file` (default `~/.yasumaro_history`),
  trimmed to `history_max_lines`. Set `history_file = ""` to disable saving

### Deleting history

The REPL history is stored in `~/.yasumaro_history` by default. Delete
that file to clear it. If you changed `history_file`, delete the path
shown by `yasumaro config`:

```sh
rm ~/.yasumaro_history
```

### Piping to AI agents

With `--json` the output is machine-readable JSON, ready for pipes:

```sh
yasumaro search --query "..." --json | jq
yasumaro search --query "..." --json | jq '.[].url'
yasumaro list --from 2026-01-01 --json | jq 'length'
yasumaro stats --json | jq '{count, topDomains}'
```

## Read-only note

The CLI opens the database in read-only mode. Search, display,
statistics, and export never modify the `.db`. The only write this tool
performs is appending to the REPL history file above.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Runtime error (cannot open the database, cannot write a file, and similar) |
| 2 | Usage error (unknown command, bad flag or value, broken config, unresolved database) |
| 3 | `--copy` failed (the output itself was still printed) |

## License notes

The crate itself is MIT. Dependencies are permissive-only (no GPL):

- `ryu` is dual-licensed Apache-2.0 / BSL-1.0
- `dirs` pulls in `option-ext`, which is MPL-2.0 (weak copyleft at file
  level). It is accepted as a transitive dependency; it does not change
  this crate's own license, and no GPL code is involved
