import { readFile } from "node:fs/promises";
import path from "node:path";

/** Only plain names like "leica-m3.jpg" or "leica-m3_thumb.jpg": never a path. */
const FILE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:_thumb)?\.jpg$/;

/**
 * Reads the demo account's bundled sample photos from a folder (Node only).
 * Files are kept in memory after the first read: they are a few megabytes in total and are
 * needed again at every demo sign-in.
 */
export function createDemoPhotoFiles(directory: string) {
  const cache = new Map<string, Uint8Array | null>();

  return async (fileName: string): Promise<Uint8Array | null> => {
    if (!FILE_NAME.test(fileName)) return null;
    if (cache.has(fileName)) return cache.get(fileName)!;
    let bytes: Uint8Array | null;
    try {
      bytes = new Uint8Array(await readFile(path.join(directory, fileName)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      bytes = null;
    }
    cache.set(fileName, bytes);
    return bytes;
  };
}
