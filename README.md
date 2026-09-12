# lightagent

Lightweight CLI agent, built on [Deno](https://deno.com).

> **Beta** — The CLI agent and the core library are in beta: they work and are
> tested, but APIs may still evolve between releases.

## Project Status

| Package            | Status          | Description                                            |
| ------------------ | --------------- | ------------------------------------------------------ |
| `lightagent-core`  | 🔶 Beta         | Common interfaces and types shared across all packages |
| `lightagent-local` | 🔶 Beta         | Ready for general use, but expect rough edges          |
| `lightagent-do`    | 🧪 Experimental | Functional, but not yet ready for general use          |

## Packages

### `lightagent-core`

Defines all the common interfaces and types used across the lightagent
ecosystem. This is the foundation that other packages build upon.

### `lightagent-local`

A local CLI agent that runs on your machine. Currently in **beta**: it works and
is tested, but may still have rough edges.

#### Installation

Download a pre-built binary from
[GitHub releases](https://github.com/AstraBert/lightagent/releases):

**Linux / macOS**

```bash
# Pick the target matching your platform:
#   aarch64-apple-darwin      (Apple Silicon)
#   x86_64-apple-darwin       (Intel Mac)
#   aarch64-unknown-linux-gnu (Linux ARM64)
#   x86_64-unknown-linux-gnu  (Linux x86_64)
curl -sL https://github.com/AstraBert/lightagent/releases/download/{version}/lightagent-cli-{target} -o lightagent-cli
chmod +x lightagent-cli
sudo mv lightagent-cli /usr/local/bin/
```

For example, to install v0.1.4-beta on Apple Silicon:

```bash
curl -sL https://github.com/AstraBert/lightagent/releases/download/v0.1.4-beta/lightagent-cli-aarch64-apple-darwin -o lightagent-cli
chmod +x lightagent-cli
sudo mv lightagent-cli /usr/local/bin/
```

**Windows**

Download `lightagent-cli-x86_64-pc-windows-msvc.exe` from the
[releases page](https://github.com/AstraBert/lightagent/releases) and run it.

#### Build from source

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

### `lightagent-do`

Experimental: the Durable Objects implementation works, but it is not yet ready
for general use. Stay tuned!

## Development

This is a Deno workspace. Make sure you have [Deno](https://deno.com) installed.

```bash
# Format code
deno fmt

# Lint
deno lint

# Run core tests
cd lightagent-core/
deno task test

# Run local tests (unit)
cd lightagent-local/
deno test -A

# Run local tests (e2e)
export ANTHROPIC_API_KEY="..."
export OPENAI_API_KEY="..."
# if needed, set custom base URL and model
# export OPENAI_BASE_URL="..."
# export ANTHROPIC_BASE_URL="..."
# export OPENAI_MODEL="..."
# export ANTHROPIC_MODEL="..."
cd lightagent-local/
deno task tests:e2e
```

## License

This project is provided under [Apache 2.0](./LICENSE)
