# yasumaro (Rust CLI)

Read-only CLI for exported Yasumaro history databases.

This is a Rust port of the JS reference implementation under
`tools/yasumaro-cli/` (branch `feature/yasumaro-cli`). The JS version is the
specification; this crate coexists with it and does not replace it.

> Status: Task 1 scaffold. Only argument parsing plus `--help`/`--version`
> and placeholder usage output work so far. Full commands
> (`search`/`list`/`show`/`stats`/`export`/`config` and the interactive
> shell) arrive in later tasks. Full user docs come in Task 6.

## Install

```sh
cargo install --path cli
```

## Usage

```sh
yasumaro --help
yasumaro --version
```

## Exit codes

- `0` success
- `1` internal failure
- `2` usage error
- `3` clipboard copy failure

## License

MIT
