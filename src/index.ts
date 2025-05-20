import * as FileSystem from "@effect/platform/FileSystem"
import * as Layer from "effect/Layer"

export * as MemoryFileSystem from "./MemoryFileSystem.ts"

export const layer = Layer.effect(
  FileSystem.FileSystem,
)

