import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type JsonStore<T> = {
  readonly path: string;
  load: () => T;
  save: (value: T) => void;
};

export type JsonStoreOptions<T> = {
  path: string;
  defaults: () => T;
  /** File mode for `writeFileSync`. Defaults to 0o600 for credential-like files. */
  mode?: number;
  /** Optional validator/parser run on loaded JSON (e.g. a Zod `.parse`). */
  parse?: (raw: unknown) => T;
};

/**
 * Tiny JSON-on-disk wrapper used for `.pi-auth.json` and `.pi-usage.json`.
 *
 * - `load` returns `defaults()` if the file does not exist.
 * - `save` ensures the parent directory exists and writes pretty-printed JSON
 *   with a trailing newline.
 */
export function createJsonStore<T>(options: JsonStoreOptions<T>): JsonStore<T> {
  const { path, defaults, mode = 0o600, parse } = options;

  return {
    path,
    load: () => {
      if (!existsSync(path)) return defaults();
      const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
      return parse ? parse(raw) : (raw as T);
    },
    save: (value) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode });
    }
  };
}
