/**
 * Node-only: stores photos in a local folder. Used in development (and for a local
 * production rehearsal) so working on the app never touches the real bucket.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertValidKey, type ImageStorage } from "./image-storage.js";

export function createLocalImageStorage(directory: string): ImageStorage {
  const root = path.resolve(directory);
  const fileFor = (key: string) => {
    assertValidKey(key);
    const file = path.resolve(root, key);
    if (file !== root && !file.startsWith(root + path.sep)) throw new Error("Storage key escapes the storage directory");
    return file;
  };

  return {
    kind: "local",
    async put(key, bytes) {
      const file = fileFor(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
    },
    async get(key) {
      try {
        const bytes = new Uint8Array(await readFile(fileFor(key)));
        return { body: bytes, contentLength: bytes.byteLength };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async delete(keys) {
      for (const key of keys) await rm(fileFor(key), { force: true });
    },
  };
}
