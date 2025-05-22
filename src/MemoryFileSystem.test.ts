import { FileSystem } from "@effect/platform"
import { describe, expect, it, test } from "bun:test"
import { Effect, Either, Fiber, pipe, Stream } from "effect"
import * as Path from "node:path"
import { MemoryFileSystem } from "./index.ts"
import { effectFn } from "./testing.ts"

const Files = {
  "/index.html": `<h1>Hello World</h1>`,
  "/.profile": `echo "Hello World"`,
}

const effect = effectFn()

const FS = pipe(
  FileSystem.FileSystem,
  Effect.provide(MemoryFileSystem.layerWith(Files)),
)

it("empty layer", () =>
  effect(function*() {
    const fs = yield* pipe(
      FileSystem.FileSystem,
      Effect.provide(MemoryFileSystem.layer),
    )

    expect(yield* fs.readDirectory("/")).toEqual([])
  }))

it("create text file", () =>
  effect(function*() {
    const fs = yield* FS

    const text = `<h1>Hello World</h1>`

    yield* fs.writeFileString(
      "/index.html",
      text,
      {
        flag: "w",
        mode: 0o755,
      },
    )

    const savedBytes = yield* fs.readFile("/index.html")
    const savedText = new TextDecoder().decode(savedBytes)

    expect(savedText).toEqual(text)
  }))

it("create and read binary file", () =>
  effect(function*() {
    const fs = yield* FS

    const binary = new Uint8Array([0x01, 0x02, 0x03, 0x04])

    yield* fs.writeFile(
      "/binary.dat",
      binary,
      {
        flag: "w",
        mode: 0o755,
      },
    )

    const savedBytes = yield* fs.readFile("/binary.dat")

    expect(savedBytes).toEqual(binary)
  }))

it("readDirectory", () =>
  effect(function*() {
    const fs = yield* FS
    const allFiles = yield* fs.readDirectory("/")

    expect(allFiles).toEqual(expect.arrayContaining([
      ".profile",
      "index.html",
    ]))
  }))

describe("file operations", () => {
  it("chmod changes file permissions", () =>
    effect(function*() {
      const fs = yield* FS
      const newMode = 0o644

      yield* fs.writeFileString(
        "/test-chmod.txt",
        "test content",
        {
          flag: "w",
          mode: 0o755,
        },
      )

      yield* fs.chmod("/test-chmod.txt", newMode)
      const fileInfo = yield* fs.stat("/test-chmod.txt")

      expect(fileInfo.mode & 0o777).toEqual(newMode)
    }))

  it("accessing nonexistent file throws NotFound error", () =>
    effect(function*() {
      const fs = yield* FS

      const result = yield* Effect.either(fs.readFile("/nonexistent.txt"))

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("SystemError")
        if (result.left._tag === "SystemError") {
          expect(result.left.reason).toBe("NotFound")
        }
      }
    }))
})

describe("remove operations", () => {
  it("remove file", () =>
    effect(function*() {
      const fs = yield* FS

      yield* fs.writeFileString(
        "/to-delete.txt",
        "delete me",
        {
          flag: "w",
          mode: 0o644,
        },
      )

      const beforeFiles = yield* fs.readDirectory("/")
      expect(beforeFiles).toContain("to-delete.txt")

      yield* fs.remove("/to-delete.txt")

      const afterFiles = yield* fs.readDirectory("/")
      expect(afterFiles).not.toContain("to-delete.txt")
    }))

  it("remove directory with recursive option", () =>
    effect(function*() {
      const fs = yield* FS

      yield* fs.makeDirectory("/test-dir", { recursive: true })

      yield* fs.writeFileString(
        "/test-dir/file.txt",
        "test content",
        {
          flag: "w",
          mode: 0o644,
        },
      )

      yield* fs.remove("/test-dir", { recursive: true })

      const files = yield* fs.readDirectory("/")
      expect(files).not.toContain("test-dir")
    }))
})

it("creating nested directories", () =>
  effect(function*() {
    const fs = yield* FS

    yield* fs.makeDirectory("/parent/child/grandchild", { recursive: true })

    expect(yield* fs.stat("/parent")).toBeDefined()
    expect(yield* fs.stat("/parent/child")).toBeDefined()
    expect(yield* fs.stat("/parent/child/grandchild")).toBeDefined()

    const parentInfo = yield* fs.stat("/parent")
    expect(parentInfo.type).toBe("Directory")
  }))

it("renaming files", () =>
  effect(function*() {
    const fs = yield* FS

    yield* fs.writeFileString(
      "/original-file.txt",
      "original content",
      {
        flag: "w",
        mode: 0o644,
      },
    )

    yield* fs.rename("/original-file.txt", "/renamed-file.txt")

    const result = yield* Effect.either(fs.stat("/original-file.txt"))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SystemError")
      if (result.left._tag === "SystemError") {
        expect(result.left.reason).toBe("NotFound")
      }
    }

    const content = yield* fs.readFileString("/renamed-file.txt")
    expect(content).toBe("original content")
  }))

it("symlink creation and resolution", () =>
  effect(function*() {
    const fs = yield* FS

    yield* fs.writeFileString(
      "/target.txt",
      "target content",
      {
        flag: "w",
        mode: 0o644,
      },
    )

    yield* fs.symlink("/target.txt", "/link.txt")

    const content = yield* fs.readFileString("/link.txt")
    expect(content).toBe("target content")

    // Note: Using stat on symlink follows the link and returns info about target
    // This is expected behavior for most filesystem operations
    const linkInfo = yield* fs.stat("/link.txt")
    expect(linkInfo.type).toBe("File")
  }))

it("copy file", () =>
  effect(function*() {
    const fs = yield* FS

    yield* fs.writeFileString(
      "/source.txt",
      "source content",
      {
        flag: "w",
        mode: 0o644,
      },
    )

    yield* fs.copyFile("/source.txt", "/destination.txt")

    const content = yield* fs.readFileString("/destination.txt")
    expect(content).toBe("source content")

    expect(yield* fs.stat("/source.txt")).toBeDefined()
    expect(yield* fs.stat("/destination.txt")).toBeDefined()
  }))

describe("temporary files and directories", () => {
  it("makeTempDirectory creates temp directory", () =>
    effect(function*() {
      const fs = yield* FS

      const tempDir = yield* fs.makeTempDirectory({ prefix: "test-" })

      const stat = yield* fs.stat(tempDir)
      expect(stat.type).toBe("Directory")

      yield* fs.remove(tempDir, { recursive: true })
    }))

  it("makeTempFile creates temp file", () =>
    effect(function*() {
      const fs = yield* FS

      const tempFile = yield* fs.makeTempFile({ prefix: "test-" })

      const stat = yield* fs.stat(tempFile)
      expect(stat.type).toBe("File")

      yield* fs.remove(tempFile, { recursive: true })
    }))
})
describe("makeTempDirectoryScoped", () => {
  it("creates temporary directory that gets cleaned up automatically", () =>
    effect(function*() {
      const fs = yield* FS
      let tempDir: string = ""

      yield* Effect.scoped(Effect.gen(function*() {
        tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "test-scoped-",
        })

        const stat = yield* fs.stat(tempDir)
        expect(stat.type).toBe("Directory")

        expect(tempDir).toMatch(/\/tmp\/.*test-scoped-/)
      }))
      const result = yield* Effect.either(fs.stat(tempDir))
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("SystemError")
        if (result.left._tag === "SystemError") {
          expect(result.left.reason).toBe("NotFound")
        }
      }
    }))

  it("creates temp directory with custom options", () =>
    effect(function*() {
      const fs = yield* FS
      let tempDir: string = ""

      yield* Effect.scoped(Effect.gen(function*() {
        tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "custom-prefix-",
          directory: "/tmp",
        })

        expect(tempDir).toMatch(/\/tmp\/.*custom-prefix-/)

        const stat = yield* fs.stat(tempDir)
        expect(stat.type).toBe("Directory")
      }))
      const result = yield* Effect.either(fs.stat(tempDir))
      expect(Either.isLeft(result)).toBe(true)
    }))

  it("can write files to scoped temp directory", () =>
    effect(function*() {
      const fs = yield* FS
      let tempDir: string = ""
      let testFilePath: string = ""

      yield* Effect.scoped(Effect.gen(function*() {
        tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "test-write-" })
        testFilePath = Path.join(tempDir, "test-file.txt")

        yield* fs.writeFileString(testFilePath, "test content", {
          flag: "w",
          mode: 0o644,
        })

        const content = yield* fs.readFileString(testFilePath)
        expect(content).toBe("test content")
      }))
      const dirResult = yield* Effect.either(fs.stat(tempDir))
      const fileResult = yield* Effect.either(fs.stat(testFilePath))

      expect(Either.isLeft(dirResult)).toBe(true)
      expect(Either.isLeft(fileResult)).toBe(true)
    }))

  it("cleans up even when error occurs in scope", () =>
    effect(function*() {
      const fs = yield* FS
      let tempDir: string = ""

      const result = yield* Effect.either(
        Effect.scoped(Effect.gen(function*() {
          tempDir = yield* fs.makeTempDirectoryScoped({
            prefix: "test-error-",
          })

          const stat = yield* fs.stat(tempDir)
          expect(stat.type).toBe("Directory")

          yield* Effect.fail(new Error("Intentional test error"))
        })),
      )

      expect(Either.isLeft(result)).toBe(true)
      const dirResult = yield* Effect.either(fs.stat(tempDir))
      expect(Either.isLeft(dirResult)).toBe(true)
      if (Either.isLeft(dirResult)) {
        expect(dirResult.left._tag).toBe("SystemError")
        if (dirResult.left._tag === "SystemError") {
          expect(dirResult.left.reason).toBe("NotFound")
        }
      }
    }))

  it("creates unique directories on multiple calls", () =>
    effect(function*() {
      const fs = yield* FS
      const tempDirs: string[] = []

      yield* Effect.scoped(Effect.gen(function*() {
        const dir1 = yield* fs.makeTempDirectoryScoped({ prefix: "unique-" })
        const dir2 = yield* fs.makeTempDirectoryScoped({ prefix: "unique-" })
        const dir3 = yield* fs.makeTempDirectoryScoped({ prefix: "unique-" })

        tempDirs.push(dir1, dir2, dir3)

        expect(new Set(tempDirs).size).toBe(3)

        for (const dir of tempDirs) {
          const stat = yield* fs.stat(dir)
          expect(stat.type).toBe("Directory")
        }
      }))
      for (const dir of tempDirs) {
        const result = yield* Effect.either(fs.stat(dir))
        expect(Either.isLeft(result)).toBe(true)
      }
    }))
})

describe("makeTempFileScoped", () => {
  it("creates temporary file that gets cleaned up automatically", () =>
    effect(function*() {
      const fs = yield* FS
      let tempFile: string = ""
      let tempDir: string = ""

      yield* Effect.scoped(Effect.gen(function*() {
        tempFile = yield* fs.makeTempFileScoped({ prefix: "test-file-" })
        tempDir = Path.dirname(tempFile)

        const stat = yield* fs.stat(tempFile)
        expect(stat.type).toBe("File")

        expect(tempFile).toMatch(/\/tmp\/.*test-file-/)

        yield* fs.writeFileString(tempFile, "temp file content", {
          flag: "w",
          mode: 0o644,
        })
        const content = yield* fs.readFileString(tempFile)
        expect(content).toBe("temp file content")
      }))
      const fileResult = yield* Effect.either(fs.stat(tempFile))
      const dirResult = yield* Effect.either(fs.stat(tempDir))

      expect(Either.isLeft(fileResult)).toBe(true)
      expect(Either.isLeft(dirResult)).toBe(true)
    }))

  it("creates temp file with custom options", () =>
    effect(function*() {
      const fs = yield* FS
      let tempFile: string = ""

      yield* Effect.scoped(Effect.gen(function*() {
        tempFile = yield* fs.makeTempFileScoped({
          prefix: "custom-file-",
          directory: "/tmp",
        })

        expect(tempFile).toMatch(/\/tmp\/.*custom-file-/)

        const stat = yield* fs.stat(tempFile)
        expect(stat.type).toBe("File")
      }))
      const result = yield* Effect.either(fs.stat(tempFile))
      expect(Either.isLeft(result)).toBe(true)
    }))

  it("cleans up even when error occurs in scope", () =>
    effect(function*() {
      const fs = yield* FS
      let tempFile: string = ""
      let tempDir: string = ""

      const result = yield* Effect.either(
        Effect.scoped(Effect.gen(function*() {
          tempFile = yield* fs.makeTempFileScoped({
            prefix: "test-file-error-",
          })
          tempDir = Path.dirname(tempFile)

          const stat = yield* fs.stat(tempFile)
          expect(stat.type).toBe("File")

          yield* fs.writeFileString(tempFile, "error test content", {
            flag: "w",
            mode: 0o644,
          })

          yield* Effect.fail(new Error("Intentional file test error"))
        })),
      )

      expect(Either.isLeft(result)).toBe(true)
      const fileResult = yield* Effect.either(fs.stat(tempFile))
      const dirResult = yield* Effect.either(fs.stat(tempDir))

      expect(Either.isLeft(fileResult)).toBe(true)
      expect(Either.isLeft(dirResult)).toBe(true)
    }))

  it("creates unique files on multiple calls", () =>
    effect(function*() {
      const fs = yield* FS
      const tempFiles: string[] = []

      yield* Effect.scoped(Effect.gen(function*() {
        const file1 = yield* fs.makeTempFileScoped({ prefix: "unique-file-" })
        const file2 = yield* fs.makeTempFileScoped({ prefix: "unique-file-" })
        const file3 = yield* fs.makeTempFileScoped({ prefix: "unique-file-" })

        tempFiles.push(file1, file2, file3)

        expect(new Set(tempFiles).size).toBe(3)

        for (let i = 0; i < tempFiles.length; i++) {
          const file = tempFiles[i]!
          const stat = yield* fs.stat(file)
          expect(stat.type).toBe("File")

          yield* fs.writeFileString(file, `content ${i}`, {
            flag: "w",
            mode: 0o644,
          })
          const content = yield* fs.readFileString(file)
          expect(content).toBe(`content ${i}`)
        }
      }))
      for (const file of tempFiles) {
        const fileResult = yield* Effect.either(fs.stat(file))
        const dirResult = yield* Effect.either(fs.stat(Path.dirname(file)))

        expect(Either.isLeft(fileResult)).toBe(true)
        expect(Either.isLeft(dirResult)).toBe(true)
      }
    }))

  it("can open and use file handles within scope", () =>
    effect(function*() {
      const fs = yield* FS
      let tempFile: string = ""

      yield* Effect.scoped(Effect.gen(function*() {
        tempFile = yield* fs.makeTempFileScoped({ prefix: "test-handle-" })

        const file = yield* fs.open(tempFile, { flag: "w+" })

        const writeData = new TextEncoder().encode("handle test data")
        yield* file.write(writeData)

        yield* file.seek(0, "start")
        const buffer = new Uint8Array(writeData.length)
        const bytesRead = yield* file.read(buffer)

        expect(Number(bytesRead)).toBe(writeData.length)
        expect(new TextDecoder().decode(buffer)).toBe("handle test data")

        yield* file.sync
      }))
      const result = yield* Effect.either(fs.stat(tempFile))
      expect(Either.isLeft(result)).toBe(true)
    }))
})

describe("scoped temp resource interactions", () => {
  it("nested scopes work correctly", () =>
    effect(function*() {
      const fs = yield* FS
      let outerDir: string = ""
      let innerDir: string = ""
      let tempFile: string = ""

      yield* Effect.scoped(Effect.gen(function*() {
        outerDir = yield* fs.makeTempDirectoryScoped({ prefix: "outer-" })

        yield* Effect.scoped(Effect.gen(function*() {
          innerDir = yield* fs.makeTempDirectoryScoped({ prefix: "inner-" })
          tempFile = yield* fs.makeTempFileScoped({ prefix: "nested-file-" })

          const outerStat = yield* fs.stat(outerDir)
          const innerStat = yield* fs.stat(innerDir)
          const fileStat = yield* fs.stat(tempFile)

          expect(outerStat.type).toBe("Directory")
          expect(innerStat.type).toBe("Directory")
          expect(fileStat.type).toBe("File")
        }))

        const innerResult = yield* Effect.either(fs.stat(innerDir))
        const fileResult = yield* Effect.either(fs.stat(tempFile))

        expect(Either.isLeft(innerResult)).toBe(true)
        expect(Either.isLeft(fileResult)).toBe(true)

        const outerStat = yield* fs.stat(outerDir)
        expect(outerStat.type).toBe("Directory")
      }))
      const outerResult = yield* Effect.either(fs.stat(outerDir))
      expect(Either.isLeft(outerResult)).toBe(true)
    }))

  it("can create files within scoped temp directories", () =>
    effect(function*() {
      const fs = yield* FS
      let tempDir: string = ""
      let createdFile: string = ""

      yield* Effect.scoped(Effect.gen(function*() {
        tempDir = yield* fs.makeTempDirectoryScoped({
          prefix: "dir-with-files-",
        })

        createdFile = Path.join(tempDir, "created-file.txt")
        const subDir = Path.join(tempDir, "subdir")
        const subFile = Path.join(subDir, "sub-file.txt")

        yield* fs.writeFileString(createdFile, "created content", {
          flag: "w",
          mode: 0o644,
        })
        yield* fs.makeDirectory(subDir)
        yield* fs.writeFileString(subFile, "sub content", {
          flag: "w",
          mode: 0o644,
        })

        const fileContent = yield* fs.readFileString(createdFile)
        const subFileContent = yield* fs.readFileString(subFile)

        expect(fileContent).toBe("created content")
        expect(subFileContent).toBe("sub content")
      }))
      const dirResult = yield* Effect.either(fs.stat(tempDir))
      const fileResult = yield* Effect.either(fs.stat(createdFile))

      expect(Either.isLeft(dirResult)).toBe(true)
      expect(Either.isLeft(fileResult)).toBe(true)
    }))
})

it("appending to files", () =>
  effect(function*() {
    const fs = yield* FS

    yield* fs.writeFileString(
      "/append.txt",
      "initial ",
      {
        flag: "w",
        mode: 0o644,
      },
    )

    yield* fs.writeFileString(
      "/append.txt",
      "appended",
      {
        flag: "a",
        mode: 0o644,
      },
    )

    const content = yield* fs.readFileString("/append.txt")
    expect(content).toBe("initial appended")
  }))

it("truncating files", () =>
  effect(function*() {
    const fs = yield* FS

    yield* fs.writeFileString(
      "/truncate.txt",
      "this is a long string",
      {
        flag: "w",
        mode: 0o644,
      },
    )

    yield* fs.truncate("/truncate.txt", 10)

    const content = yield* fs.readFileString("/truncate.txt")
    expect(content).toBe("this is a ")
    expect(content.length).toBe(10)
  }))

it("reading partial file content", () =>
  effect(function*() {
    const fs = yield* FS

    const text = "abcdefghijklmnopqrstuvwxyz"
    yield* fs.writeFileString(
      "/partial.txt",
      text,
      {
        flag: "w",
        mode: 0o644,
      },
    )

    const file = yield* fs.open("/partial.txt", { flag: "r" })

    const buffer = new Uint8Array(5)
    yield* file.read(buffer)

    expect(new TextDecoder().decode(buffer)).toBe("abcde")

    yield* file.seek(10, "start")
    const buffer2 = new Uint8Array(5)
    yield* file.read(buffer2)

    expect(new TextDecoder().decode(buffer2)).toBe("klmno")
  }))

it("stat verifies file metadata", () =>
  effect(function*() {
    const fs = yield* FS

    const mode = 0o644
    const text = "stat test content"
    yield* fs.writeFileString(
      "/stat.txt",
      text,
      {
        flag: "w",
        mode,
      },
    )

    const stat = yield* fs.stat("/stat.txt")

    expect(stat.type).toBe("File")
    expect(stat.mode & 0o777).toBe(mode)
    expect(Number(stat.size)).toBe(text.length)
    expect(stat.mtime._tag).toBe("Some")
  }))

describe("file watching", () => {
  it("watches file creation in directory", () =>
    effect(function*() {
      const fs = yield* FS

      const watchDir = "/watch-dir"
      yield* fs.makeDirectory(watchDir, { recursive: true })

      const events: FileSystem.WatchEvent[] = []

      const watchStream = fs.watch(watchDir)

      const watchFiber = yield* Stream.take(watchStream, 1).pipe(
        Stream.runForEach(event =>
          Effect.sync(() => {
            events.push(event)
          })
        ),
        Effect.fork,
      )

      yield* Effect.sleep(1)

      yield* fs.writeFileString(
        `${watchDir}/new-file.txt`,
        "test content",
      )
      yield* Fiber.join(watchFiber)

      expect(events.length).toBeGreaterThan(0)
      const createEvent = events.find(e => e._tag === "Create")
      expect(createEvent).toBeDefined()
      if (createEvent && createEvent._tag === "Create") {
        expect(createEvent.path).toMatch(/new-file\.txt$/)
      }
    }))

  it("watches file modification", () =>
    effect(function*() {
      const fs = yield* FS

      const watchDir = "/watch-mod-dir"
      const filePath = `${watchDir}/watched-file.txt`

      yield* fs.makeDirectory(watchDir, { recursive: true })

      const events: FileSystem.WatchEvent[] = []

      const watchStream = fs.watch(watchDir)

      const watchFiber = yield* Stream.take(watchStream, 2).pipe(
        Stream.runForEach(event =>
          Effect.sync(() => {
            events.push(event)
          })
        ),
        Effect.fork,
      )

      yield* Effect.sleep(1)

      yield* fs.writeFileString(
        filePath,
        "initial content",
      )

      yield* Effect.sleep(1)

      yield* fs.writeFileString(
        filePath,
        "modified content",
      )

      yield* Fiber.join(watchFiber)

      expect(events.length).toBeGreaterThan(0)
      const hasUpdateEvent = events.some(e => e._tag === "Update")
      const hasCreateEvent = events.some(e => e._tag === "Create")
      const hasRemoveEvent = events.some(e => e._tag === "Remove")

      expect(hasUpdateEvent || hasCreateEvent || hasRemoveEvent).toBe(true)
    }))

  it("watches file deletion", () =>
    effect(function*() {
      const fs = yield* FS

      const watchDir = "/watch-delete-dir"
      const filePath = `${watchDir}/file-to-delete.txt`

      yield* fs.makeDirectory(watchDir, { recursive: true })

      const events: FileSystem.WatchEvent[] = []

      const watchStream = fs.watch(watchDir)

      const watchFiber = yield* Stream.take(watchStream, 2).pipe(
        Stream.runForEach(event =>
          Effect.sync(() => {
            events.push(event)
          })
        ),
        Effect.fork,
      )

      yield* Effect.sleep(1)

      yield* fs.writeFileString(
        filePath,
        "content to delete",
      )

      yield* Effect.sleep(1)

      yield* fs.remove(filePath)
      yield* Fiber.join(watchFiber)

      expect(events.length).toBeGreaterThan(0)
      const removeEvent = events.find(e => e._tag === "Remove")
      expect(removeEvent).toBeDefined()
      if (removeEvent && removeEvent._tag === "Remove") {
        expect(removeEvent.path).toMatch(/file-to-delete\.txt$/)
      }
    }))

  it("watches multiple file operations in sequence", () =>
    effect(function*() {
      const fs = yield* FS

      const watchDir = "/watch-multi-dir"
      yield* fs.makeDirectory(watchDir, { recursive: true })

      const events: FileSystem.WatchEvent[] = []

      const watchStream = fs.watch(watchDir)

      const watchFiber = yield* Stream.take(watchStream, 4).pipe(
        Stream.runForEach(event =>
          Effect.sync(() => {
            events.push(event)
          })
        ),
        Effect.fork,
      )

      yield* Effect.sleep(1)

      const filePath = `${watchDir}/multi-test.txt`
      yield* fs.writeFileString(filePath, "initial")
      yield* Effect.sleep(1)

      yield* fs.writeFileString(filePath, "modified")
      yield* Effect.sleep(1)

      yield* fs.remove(filePath)
      yield* Effect.sleep(1)
      yield* Fiber.join(watchFiber)

      expect(events.length).toBeGreaterThan(0)

      const hasCreateEvent = events.some(e => e._tag === "Create")
      const hasUpdateEvent = events.some(e => e._tag === "Update")
      const hasRemoveEvent = events.some(e => e._tag === "Remove")

      expect(hasCreateEvent || hasUpdateEvent || hasRemoveEvent).toBe(true)
    }))

  it("watches nested directory operations", () =>
    effect(function*() {
      const fs = yield* FS

      const rootDir = "/watch-nested"
      yield* fs.makeDirectory(rootDir, { recursive: true })

      const events: FileSystem.WatchEvent[] = []

      const watchStream = fs.watch(rootDir)

      const watchFiber = yield* Stream.take(watchStream, 2).pipe(
        Stream.runForEach(event =>
          Effect.sync(() => {
            events.push(event)
          })
        ),
        Effect.fork,
      )

      yield* Effect.sleep(1)

      const subDir = `${rootDir}/subdir`
      yield* fs.makeDirectory(subDir)
      yield* Effect.sleep(1)

      yield* fs.writeFileString(
        `${subDir}/nested-file.txt`,
        "nested content",
      )
      yield* Effect.sleep(1)
      yield* Fiber.join(watchFiber)

      expect(events.length).toBeGreaterThan(0)

      const hasCreateEvent = events.some(e => e._tag === "Create")
      expect(hasCreateEvent).toBe(true)
    }))
})

describe("error handling", () => {
  it("making directory that already exists throws AlreadyExists error", () =>
    effect(function*() {
      const fs = yield* FS

      yield* fs.makeDirectory("/existing-dir-test", { recursive: false })

      const result = yield* Effect.either(
        fs.makeDirectory("/existing-dir-test", { recursive: false }),
      )

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("SystemError")
        if (result.left._tag === "SystemError") {
          expect(result.left.reason).toBe("AlreadyExists")
        }
      }
    }))

  it("removing non-empty directory without recursive flag throws error", () =>
    effect(function*() {
      const fs = yield* FS

      yield* fs.makeDirectory("/non-empty-dir-test", { recursive: true })
      yield* fs.writeFileString(
        "/non-empty-dir-test/file.txt",
        "content",
      )

      const result = yield* Effect.either(
        fs.remove("/non-empty-dir-test", { recursive: false }),
      )

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("SystemError")
      }

      yield* fs.remove("/non-empty-dir-test", { recursive: true })
    }))
})
