import { isAbsolute, join, relative, resolve } from "node:path";

/**
 * Where raw nutrition datasets live on disk.
 *
 * RAW DATA NEVER ENTERS THE WEB APPLICATION.
 *
 * Datasets are read by ingestion scripts only. They are not in `public/`, not
 * under `src/app/`, not bundled, and not uploaded to Supabase Storage. Two
 * reasons, and either alone would be sufficient:
 *
 *   1. Several of the source datasets carry redistribution restrictions that
 *      have not been reviewed. A file in `public/` is published to the world.
 *   2. The application has no reason to read a CSV. It reads normalized rows
 *      through the database, which is the whole point of the pipeline.
 *
 * The directory is configurable through NUTRITION_DATA_DIR and defaults to
 * `data/nutrition` in the working directory. It is git-ignored: the datasets
 * are not ours to commit.
 *
 * Nothing here is imported by application code — only by scripts.
 */

export const NUTRITION_DATA_DIR_VAR = "NUTRITION_DATA_DIR";
export const DEFAULT_NUTRITION_DATA_DIR = join("data", "nutrition");

/**
 * The configured dataset directory, as an absolute path.
 *
 * Relative values resolve against the working directory so a checked-in
 * `.env.example` can suggest one without embedding anyone's machine layout.
 */
export function nutritionDataDir(
  env: Readonly<Partial<Record<string, string>>> = process.env,
): string {
  const configured = env[NUTRITION_DATA_DIR_VAR]?.trim();
  const dir = configured && configured !== "" ? configured : DEFAULT_NUTRITION_DATA_DIR;
  return isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
}

/**
 * Resolves a manifest-declared file name inside the data directory.
 *
 * Containment is re-checked here even though the manifest schema already
 * refuses path separators. A manifest is a file on disk that someone can edit,
 * the schema could be relaxed by a future change, and the cost of checking
 * twice is one comparison — while the cost of not checking is an importer that
 * can be pointed at any file the process can read.
 *
 * @throws when the resolved path would escape the data directory.
 */
export function resolveDatasetFile(
  fileName: string,
  env: Readonly<Partial<Record<string, string>>> = process.env,
): string {
  const root = nutritionDataDir(env);
  const target = resolve(root, fileName);

  const inside = relative(root, target);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error(
      `Refusing to read "${fileName}": it resolves outside the nutrition data directory.`,
    );
  }

  return target;
}

/**
 * Strips a path down to its file name.
 *
 * Import manifests record which file they read, and that record is stored in
 * the database and printed in reports. A full path would leak the machine's
 * directory layout and, on a developer machine, usually a username — neither of
 * which belongs in a database row.
 */
export function displayFileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}
