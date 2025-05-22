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
