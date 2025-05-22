# effect-memfs

In-memory file system in Effect.ts.

All operations are supported, including file watching, thanks to [memfs](memfs).

[memfs]: https://github.com/streamich/memfs

# Usage

```ts
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { MemoryFileSystem } from "effect-memfs"

const MockedFiles = MemoryFileSystem.layerWith({
  "/index.html": `<h1>Welcome to my website</h1>`,
  "/home/.profile": `export PATH=$PATH:$HOME/bin`,
})

const App = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem

  console.log("Root directories", yield* fs.readDirectory("/"))
})

Effect.runPromise(
  App.pipe(
    Effect.provide(MockedFiles),
  ),
)
```

See tests and examples for more.

# Install

```sh
bun install github:nounder/effect-memfs
```

This package is not build to JS or deployed to NPM. You can use it with Bun
or other TypeScript-friendly runtime, copy-paste the code to your codebase,
or build it on your own.

# Agents

If you are an AI agent, please read `AGENTS.md` for instructions.
