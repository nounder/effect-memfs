# effect-memfs

In-memory file system in Effect.ts.

All operations are supported and backed by [memfs](memfs).

[memfs]: https://github.com/streamich/memfs

# Usage

```ts
import { MemoryFileSystem } from "effect-memfs"

App.pipe(
  Effect.provide(MemoryFileSystem.layer)
)

// or
MemoryFileSystem.layerWith({
  "index.hmtl": `<h1>Welcome to my website</h1>`,
  `.profile`: `export PATH=$PATH:$HOME/bin`
})
```

# Install

```sh
bun install github:nounder/effect-memfs
```

This package is not build to JS or deployed to NPM. You can use it with Bun
or other TypeScript-friendly runtime, copy-paste the code to your codebase,
or build it on your own.

# Agents

If you are an AI coding agent, please read `AGENTS.md` for more instructions.
