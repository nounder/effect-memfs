import * as FileSystem from "@effect/platform/FileSystem"
import * as Layer from "effect/Layer"
import * as MemoryFileSystem from "./MemoryFileSystem.ts"

export const layer = Layer.effect(
  FileSystem.FileSystem,
  MemoryFileSystem.make(),
)

export const layerWith = (contents: MemoryFileSystem.Contents) =>
  Layer.effect(
    FileSystem.FileSystem,
    MemoryFileSystem.make(contents),
  )

export { MemoryFileSystem }
