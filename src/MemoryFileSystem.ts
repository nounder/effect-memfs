import { effectify } from "@effect/platform/Effectify"
import * as Error from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import { Layer } from "effect"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as memfs from "memfs"
import * as Crypto from "node:crypto"
import * as NFS from "node:fs"
import * as OS from "node:os"
import * as Path from "node:path"
import { handleErrnoException } from "./error.ts"

export type Contents = memfs.DirectoryJSON

const handleBadArgument = (method: string) => (err: unknown) =>
  new Error.BadArgument({
    module: "FileSystem",
    method,
    description: (err as Error).message ?? String(err),
  })

export function make(contents?: Contents, opts?: {
  cwd: string
}) {
  const cwd = opts?.cwd ?? "/"
  const NFS = memfs.createFsFromVolume(
    contents
      ? memfs.Volume.fromJSON(contents, cwd)
      : new memfs.Volume({}),
  )

  const access = (() => {
    const nodeAccess = effectify(
      NFS.access,
      handleErrnoException("FileSystem", "access"),
      handleBadArgument("access"),
    )
    return (path: string, options?: FileSystem.AccessFileOptions) => {
      let mode = NFS.constants.F_OK
      if (options?.readable) {
        mode |= NFS.constants.R_OK
      }
      if (options?.writable) {
        mode |= NFS.constants.W_OK
      }
      return nodeAccess(path, mode)
    }
  })()

  // == copy

  const copy = (() => {
    const nodeCp = effectify(
      NFS.cp,
      handleErrnoException("FileSystem", "copy"),
      handleBadArgument("copy"),
    )
    return (
      fromPath: string,
      toPath: string,
      options?: FileSystem.CopyOptions,
    ) =>
      nodeCp(fromPath, toPath, {
        force: options?.overwrite ?? false,
        preserveTimestamps: options?.preserveTimestamps ?? false,
        recursive: true,
        mode: 0,
        verbatimSymlinks: false,
      })
  })()

  // == copyFile

  const copyFile = (() => {
    const nodeCopyFile = effectify(
      NFS.copyFile,
      handleErrnoException("FileSystem", "copyFile"),
      handleBadArgument("copyFile"),
    )
    return (fromPath: string, toPath: string) => nodeCopyFile(fromPath, toPath)
  })()

  // == chmod

  const chmod = (() => {
    const nodeChmod = effectify(
      NFS.chmod,
      handleErrnoException("FileSystem", "chmod"),
      handleBadArgument("chmod"),
    )
    return (path: string, mode: number) => nodeChmod(path, mode)
  })()

  // == chown

  const chown = (() => {
    const nodeChown = effectify(
      NFS.chown,
      handleErrnoException("FileSystem", "chown"),
      handleBadArgument("chown"),
    )
    return (path: string, uid: number, gid: number) => nodeChown(path, uid, gid)
  })()

  // == link

  const link = (() => {
    const nodeLink = effectify(
      NFS.link,
      handleErrnoException("FileSystem", "link"),
      handleBadArgument("link"),
    )
    return (existingPath: string, newPath: string) =>
      nodeLink(existingPath, newPath)
  })()

  // == makeDirectory

  const makeDirectory = (() => {
    const nodeMkdir = effectify(
      NFS.mkdir,
      handleErrnoException("FileSystem", "makeDirectory"),
      handleBadArgument("makeDirectory"),
    )
    return (path: string, options?: FileSystem.MakeDirectoryOptions) =>
      nodeMkdir(path, {
        recursive: options?.recursive ?? false,
        mode: options?.mode ?? 0o755,
      })
  })()

  // == makeTempDirectory

  const makeTempDirectoryFactory = (method: string) => {
    const nodeMkdtemp = effectify(
      NFS.mkdtemp,
      handleErrnoException("FileSystem", method),
      handleBadArgument(method),
    )
    const nodeMkdir = effectify(
      NFS.mkdir,
      handleErrnoException("FileSystem", method),
      handleBadArgument(method),
    )
    return (options?: FileSystem.MakeTempDirectoryOptions) =>
      Effect.suspend(() => {
        const prefix = options?.prefix ?? ""
        const tmpDirParent = Path.join(options?.directory ?? "/tmp", ".")

        // Ensure the temp directory exists in memory filesystem
        return pipe(
          nodeMkdir(tmpDirParent, { recursive: true }),
          Effect.flatMap(() =>
            nodeMkdtemp(
              prefix ? Path.join(tmpDirParent, prefix) : tmpDirParent + "/",
            )
          ),
        )
      })
  }
  const makeTempDirectory = makeTempDirectoryFactory("makeTempDirectory")

  // == remove

  const removeFactory = (method: string) => {
    const nodeRm = effectify(
      NFS.rm,
      handleErrnoException("FileSystem", method),
      handleBadArgument(method),
    )
    return (path: string, options?: FileSystem.RemoveOptions) =>
      nodeRm(
        path,
        {
          recursive: options?.recursive ?? false,
          force: options?.force ?? false,
        },
      )
  }
  const remove = removeFactory("remove")

  // == makeTempDirectoryScoped

  const makeTempDirectoryScoped = (() => {
    const makeDirectory = makeTempDirectoryFactory("makeTempDirectoryScoped")
    const removeDirectory = removeFactory("makeTempDirectoryScoped")
    return (
      options?: FileSystem.MakeTempDirectoryOptions,
    ) =>
      Effect.acquireRelease(
        makeDirectory(options),
        (directory) =>
          Effect.orDie(removeDirectory(directory, { recursive: true })),
      )
  })()

  // == open

  const openFactory = (method: string) => {
    const nodeOpen = effectify(
      NFS.open,
      handleErrnoException("FileSystem", method),
      handleBadArgument(method),
    )
    const nodeClose = effectify(
      NFS.close,
      handleErrnoException("FileSystem", method),
      handleBadArgument(method),
    )

    return (path: string, options?: FileSystem.OpenFileOptions) =>
      pipe(
        Effect.acquireRelease(
          nodeOpen(path, options?.flag ?? "r", options?.mode ?? 0o666),
          (fd) => Effect.orDie(nodeClose(fd)),
        ),
        Effect.map((fd) =>
          makeFile(
            FileSystem.FileDescriptor(fd),
            options?.flag?.startsWith("a") ?? false,
          )
        ),
      )
  }
  const open = openFactory("open")

  const makeFile = (() => {
    const nodeReadFactory = (method: string) =>
      effectify(
        NFS.read,
        handleErrnoException("FileSystem", method),
        handleBadArgument(method),
      )
    const nodeRead = nodeReadFactory("read")
    const nodeReadAlloc = nodeReadFactory("readAlloc")
    const nodeStat = effectify(
      NFS.fstat,
      handleErrnoException("FileSystem", "stat"),
      handleBadArgument("stat"),
    )
    const nodeTruncate = effectify(
      NFS.ftruncate,
      handleErrnoException("FileSystem", "truncate"),
      handleBadArgument("truncate"),
    )

    const nodeSync = effectify(
      NFS.fsync,
      handleErrnoException("FileSystem", "sync"),
      handleBadArgument("sync"),
    )

    const nodeWrite = effectify(
      (
        fd: number,
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number | null,
        cb: (err: NodeJS.ErrnoException | null, written?: number) => void,
      ) => NFS.write(fd, buffer, offset, length, position as any, cb),
      handleErrnoException("FileSystem", "write"),
      handleBadArgument("write"),
    )
    const nodeWriteAll = effectify(
      (
        fd: number,
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number | null,
        cb: (err: NodeJS.ErrnoException | null, written?: number) => void,
      ) => NFS.write(fd, buffer, offset, length, position as any, cb),
      handleErrnoException("FileSystem", "writeAll"),
      handleBadArgument("writeAll"),
    )

    class FileImpl implements FileSystem.File {
      readonly [FileSystem.FileTypeId]: FileSystem.FileTypeId

      private readonly semaphore = Effect.unsafeMakeSemaphore(1)
      private position: bigint = 0n

      constructor(
        readonly fd: FileSystem.File.Descriptor,
        private readonly append: boolean,
      ) {
        this[FileSystem.FileTypeId] = FileSystem.FileTypeId
      }

      get stat() {
        return Effect.map(
          nodeStat(this.fd) as Effect.Effect<NFS.Stats, any, never>,
          makeFileInfo,
        )
      }

      get sync() {
        return nodeSync(this.fd)
      }

      seek(offset: FileSystem.SizeInput, from: FileSystem.SeekMode) {
        const offsetSize = FileSystem.Size(offset)
        return this.semaphore.withPermits(1)(
          Effect.sync(() => {
            if (from === "start") {
              this.position = offsetSize
            } else if (from === "current") {
              this.position = this.position + offsetSize
            }

            return this.position
          }),
        )
      }

      read(buffer: Uint8Array) {
        return this.semaphore.withPermits(1)(
          Effect.map(
            Effect.suspend(() =>
              nodeRead(this.fd, buffer, 0, buffer.length, Number(this.position))
            ),
            (bytesRead) => {
              const sizeRead = FileSystem.Size(bytesRead)
              this.position = this.position + sizeRead
              return sizeRead
            },
          ),
        )
      }

      readAlloc(size: FileSystem.SizeInput) {
        const sizeNumber = Number(size)
        return this.semaphore.withPermits(1)(Effect.flatMap(
          Effect.sync(() => Buffer.allocUnsafeSlow(sizeNumber)),
          (buffer) =>
            Effect.map(
              nodeReadAlloc(
                this.fd,
                buffer,
                0,
                sizeNumber,
                Number(this.position),
              ),
              (bytesRead): Option.Option<Buffer> => {
                if (bytesRead === 0) {
                  return Option.none()
                }

                this.position = this.position + BigInt(bytesRead)
                if (bytesRead === sizeNumber) {
                  return Option.some(buffer)
                }

                const dst = Buffer.allocUnsafeSlow(bytesRead)
                buffer.copy(dst, 0, 0, bytesRead)
                return Option.some(dst)
              },
            ),
        ))
      }

      truncate(length?: FileSystem.SizeInput) {
        return this.semaphore.withPermits(1)(
          Effect.map(
            nodeTruncate(this.fd, length ? Number(length) : 0),
            () => {
              if (!this.append) {
                const len = BigInt(length ?? 0)
                if (this.position > len) {
                  this.position = len
                }
              }
            },
          ),
        )
      }

      write(buffer: Uint8Array) {
        return this.semaphore.withPermits(1)(
          Effect.map(
            Effect.suspend(() =>
              nodeWrite(
                this.fd,
                buffer,
                0,
                buffer.length,
                this.append ? null : Number(this.position),
              )
            ),
            (bytesWritten) => {
              const sizeWritten = FileSystem.Size(bytesWritten)
              if (!this.append) {
                this.position = this.position + sizeWritten
              }

              return sizeWritten
            },
          ),
        )
      }

      private writeAllChunk(
        buffer: Uint8Array,
      ): Effect.Effect<void, Error.PlatformError> {
        return Effect.flatMap(
          Effect.suspend(() =>
            nodeWriteAll(
              this.fd,
              buffer,
              0,
              buffer.length,
              this.append ? null : Number(this.position),
            )
          ),
          (bytesWritten) => {
            if (bytesWritten === 0) {
              return Effect.fail(
                new Error.SystemError({
                  module: "FileSystem",
                  method: "writeAll",
                  reason: "WriteZero",
                  pathOrDescriptor: this.fd,
                }),
              )
            }

            if (!this.append) {
              this.position = this.position + BigInt(bytesWritten)
            }

            return bytesWritten < buffer.length
              ? this.writeAllChunk(buffer.subarray(bytesWritten))
              : Effect.void
          },
        )
      }

      writeAll(buffer: Uint8Array) {
        return this.semaphore.withPermits(1)(this.writeAllChunk(buffer))
      }
    }

    return (fd: FileSystem.File.Descriptor, append: boolean): FileSystem.File =>
      new FileImpl(fd, append)
  })()

  // == makeTempFile

  const makeTempFileFactory = (method: string) => {
    const makeDirectory = makeTempDirectoryFactory(method)
    const open = openFactory(method)
    const randomHexString = (bytes: number) =>
      Effect.sync(() => Crypto.randomBytes(bytes).toString("hex"))
    return (options?: FileSystem.MakeTempFileOptions) =>
      pipe(
        Effect.zip(makeDirectory(options), randomHexString(6)),
        Effect.map(([directory, random]) => Path.join(directory, random)),
        Effect.tap((path) => Effect.scoped(open(path, { flag: "w+" }))),
      )
  }
  const makeTempFile = makeTempFileFactory("makeTempFile")

  // == makeTempFileScoped

  const makeTempFileScoped = (() => {
    const makeFile = makeTempFileFactory("makeTempFileScoped")
    const removeDirectory = removeFactory("makeTempFileScoped")
    return (options?: FileSystem.MakeTempFileOptions) =>
      Effect.acquireRelease(
        makeFile(options),
        (file) =>
          Effect.orDie(
            removeDirectory(Path.dirname(file), { recursive: true }),
          ),
      )
  })()

  // == readDirectory

  const readDirectory = (
    path: string,
    options?: FileSystem.ReadDirectoryOptions,
  ) =>
    Effect.tryPromise({
      try: async () => {
        const entries = await NFS.promises.readdir(path, options)
        // Ensure we always return string array
        if (
          Array.isArray(entries) && entries.length > 0
          && typeof entries[0] === "string"
        ) {
          return entries as string[]
        }
        // Convert Dirent objects to strings
        return entries.map((entry: any) =>
          typeof entry === "string" ? entry : entry.name
        ) as string[]
      },
      catch: (err) =>
        handleErrnoException("FileSystem", "readDirectory")(err as any, [path]),
    })

  // == readFile

  const readFile = (path: string) =>
    Effect.async<Uint8Array, Error.PlatformError>((resume, signal) => {
      try {
        NFS.readFile(path, (err, data) => {
          if (err) {
            resume(
              Effect.fail(
                handleErrnoException("FileSystem", "readFile")(err, [path]),
              ),
            )
          } else {
            resume(Effect.succeed(data as Uint8Array))
          }
        })
      } catch (err) {
        resume(Effect.fail(handleBadArgument("readFile")(err)))
      }
    })

  // == readLink

  const readLink = (() => {
    const nodeReadLink = effectify(
      NFS.readlink,
      handleErrnoException("FileSystem", "readLink"),
      handleBadArgument("readLink"),
    )
    return (path: string) =>
      Effect.map(nodeReadLink(path), (result) => String(result))
  })()

  // == realPath

  const realPath = (() => {
    const nodeRealPath = effectify(
      NFS.realpath,
      handleErrnoException("FileSystem", "realPath"),
      handleBadArgument("realPath"),
    )
    return (path: string) =>
      Effect.map(nodeRealPath(path), (result) => String(result))
  })()

  // == rename

  const rename = (() => {
    const nodeRename = effectify(
      NFS.rename,
      handleErrnoException("FileSystem", "rename"),
      handleBadArgument("rename"),
    )
    return (oldPath: string, newPath: string) => nodeRename(oldPath, newPath)
  })()

  // == stat

  const makeFileInfo = (stat: NFS.Stats): FileSystem.File.Info => ({
    type: stat.isFile()
      ? "File"
      : stat.isDirectory()
      ? "Directory"
      : stat.isSymbolicLink()
      ? "SymbolicLink"
      : stat.isBlockDevice()
      ? "BlockDevice"
      : stat.isCharacterDevice()
      ? "CharacterDevice"
      : stat.isFIFO()
      ? "FIFO"
      : stat.isSocket()
      ? "Socket"
      : "Unknown",
    mtime: Option.fromNullable(stat.mtime),
    atime: Option.fromNullable(stat.atime),
    birthtime: Option.fromNullable(stat.birthtime),
    dev: Number(stat.dev),
    rdev: Option.fromNullable(stat.rdev ? Number(stat.rdev) : null),
    ino: Option.fromNullable(stat.ino ? Number(stat.ino) : null),
    mode: stat.mode,
    nlink: Option.fromNullable(stat.nlink ? Number(stat.nlink) : null),
    uid: Option.fromNullable(stat.uid ? Number(stat.uid) : null),
    gid: Option.fromNullable(stat.gid ? Number(stat.gid) : null),
    size: FileSystem.Size(stat.size),
    blksize: Option.fromNullable(
      stat.blksize ? FileSystem.Size(stat.blksize) : null,
    ),
    blocks: Option.fromNullable(stat.blocks ? Number(stat.blocks) : null),
  })
  const stat = (() => {
    const nodeStat = effectify(
      NFS.stat,
      handleErrnoException("FileSystem", "stat"),
      handleBadArgument("stat"),
    )
    return (path: string) =>
      Effect.map(
        nodeStat(path) as Effect.Effect<NFS.Stats, any, never>,
        makeFileInfo,
      )
  })()

  // == symlink

  const symlink = (() => {
    const nodeSymlink = effectify(
      NFS.symlink,
      handleErrnoException("FileSystem", "symlink"),
      handleBadArgument("symlink"),
    )
    return (target: string, path: string) => nodeSymlink(target, path)
  })()

  // == truncate

  const truncate = (() => {
    const nodeTruncate = effectify(
      NFS.truncate,
      handleErrnoException("FileSystem", "truncate"),
      handleBadArgument("truncate"),
    )
    return (path: string, length?: FileSystem.SizeInput) =>
      nodeTruncate(path, length !== undefined ? Number(length) : 0)
  })()

  // == utimes

  const utimes = (() => {
    const nodeUtimes = effectify(
      NFS.utimes,
      handleErrnoException("FileSystem", "utime"),
      handleBadArgument("utime"),
    )
    return (path: string, atime: number | Date, mtime: number | Date) =>
      nodeUtimes(path, atime, mtime)
  })()

  // == watch

  const watchNode = (watchPath: string) =>
    Stream.asyncScoped<FileSystem.WatchEvent, Error.PlatformError>((emit) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const watcher = NFS.watch(watchPath, {}, (event, filename) => {
            if (!filename) return
            const fullPath = Path.isAbsolute(filename)
              ? filename
              : Path.join(watchPath, filename)
            switch (event) {
              case "rename": {
                emit.fromEffect(Effect.match(stat(fullPath), {
                  onSuccess: (_) =>
                    FileSystem.WatchEventCreate({ path: fullPath }),
                  onFailure: (_) =>
                    FileSystem.WatchEventRemove({ path: fullPath }),
                }))
                return
              }
              case "change": {
                emit.single(FileSystem.WatchEventUpdate({ path: fullPath }))
                return
              }
            }
          })
          watcher.on("error", (error) => {
            emit.fail(
              new Error.SystemError({
                module: "FileSystem",
                reason: "Unknown",
                method: "watch",
                pathOrDescriptor: watchPath,
                description: error.message,
              }),
            )
          })
          watcher.on("close", () => {
            emit.end()
          })
          return watcher
        }),
        (watcher) => Effect.sync(() => watcher.close()),
      )
    )

  const watch = (
    backend: Option.Option<Context.Tag.Service<FileSystem.WatchBackend>>,
    path: string,
  ) =>
    stat(path).pipe(
      Effect.map((stat) =>
        backend.pipe(
          Option.flatMap((_) => _.register(path, stat)),
          Option.getOrElse(() => watchNode(path)),
        )
      ),
      Stream.unwrap,
    )

  // == writeFile

  const writeFile = (
    path: string,
    data: Uint8Array,
    options?: FileSystem.WriteFileOptions,
  ) =>
    Effect.async<void, Error.PlatformError>((resume, signal) => {
      try {
        NFS.writeFile(path, data, {
          flag: options?.flag ?? "w",
          mode: options?.mode ?? 0o755,
        }, (err) => {
          if (err) {
            resume(
              Effect.fail(
                handleErrnoException("FileSystem", "writeFile")(err, [path]),
              ),
            )
          } else {
            resume(Effect.void)
          }
        })
      } catch (err) {
        resume(Effect.fail(handleBadArgument("writeFile")(err)))
      }
    })

  return Effect.map(
    Effect.serviceOption(FileSystem.WatchBackend),
    (backend) =>
      FileSystem.make({
        access,
        chmod,
        chown,
        copy,
        copyFile,
        link,
        makeDirectory,
        makeTempDirectory,
        makeTempDirectoryScoped,
        makeTempFile,
        makeTempFileScoped,
        open,
        readDirectory,
        readFile,
        readLink,
        realPath,
        remove,
        rename,
        stat,
        symlink,
        truncate,
        utimes,
        watch(path) {
          return watch(backend, path)
        },
        writeFile,
      }),
  )
}

export const layer = Layer.effect(
  FileSystem.FileSystem,
  make(),
)

export const layerWith = (contents: Contents) =>
  Layer.effect(
    FileSystem.FileSystem,
    make(contents),
  )
