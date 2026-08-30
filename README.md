# lightagent

Lightweight CLI agent, built on [Deno](https://deno.com).

> ⚠️ **Work in Progress** — Everything here is still pretty much WIP. APIs may change, features may break, and dragons may be present. Use at your own risk!

## Project Status

| Package | Status | Description |
|---------|--------|-------------|
| `lightagent-core` | 🚧 WIP | Common interfaces and types shared across all packages |
| `lightagent-local` | 🧪 Alpha | Ready for testing, but expect rough edges |
| `lightagent-do` | 🚧 WIP | Actively being developed, not ready for use |

## Packages

### `lightagent-core`

Defines all the common interfaces and types used across the lightagent ecosystem. This is the foundation that other packages build upon.

### `lightagent-local`

A local CLI agent that runs on your machine. Currently in **alpha** — it works, but needs more testing and polish.

#### Quick Start

```bash
# Clone the repository
git clone https://github.com/AstraBert/lightagent
cd lightagent

# Build the binary
cd lightagent-local
deno task build

# The binary will be available as ./lightagent-cli
./lightagent-cli --help
```

You can also download the binary from the [releases page](https://github.com/AstraBer/lightagent/releases)

### `lightagent-do`

Work in progress. Stay tuned!

## Development

This is a Deno workspace. Make sure you have [Deno](https://deno.com) installed.

```bash
# Format code
deno fmt

# Lint
deno lint
```
