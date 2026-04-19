import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as dotenv from "dotenv";

/**
 * Configuration for the CDA backup process.
 */
export interface BackupConfig {
  /** Base path where the Delta app stores setups (source). */
  sourcePath: string;
  /** Base path where backups should be written (destination). */
  destinationPath: string;
  /** How often to run the backup, in seconds. */
  intervalSeconds: number;
}

/**
 * Returns today's date formatted as YYYYMMDD.
 */
export function getTodayDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/**
 * Computes the MD5 hash of a file's contents.
 */
export function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("md5").update(content).digest("hex");
}

/**
 * Recursively finds all files whose names start with "CDA" under the given directory.
 * Returns an array of absolute file paths.
 */
export function findCdaFiles(dir: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findCdaFiles(fullPath));
    } else if (entry.isFile() && entry.name.startsWith("CDA")) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Derives the backup destination file path for a given source file.
 *
 * - Strips the "CDA" prefix from the file name.
 * - Appends "-YYYYMMDD" before the file extension (or at the end if no extension).
 * - Preserves the relative directory structure (car / map subdirectories) under destinationPath.
 */
export function buildDestinationPath(
  sourceFile: string,
  sourcePath: string,
  destinationPath: string,
  date: Date = new Date()
): string {
  const relativePath = path.relative(sourcePath, sourceFile);
  const dir = path.dirname(relativePath);
  const fileName = path.basename(relativePath);

  // Remove CDA prefix
  const nameWithoutPrefix = fileName.startsWith("CDA")
    ? fileName.slice(3)
    : fileName;

  // Insert date postfix before the extension
  const ext = path.extname(nameWithoutPrefix);
  const base = path.basename(nameWithoutPrefix, ext);
  const dateStr = getTodayDateString(date);
  const newFileName = `${base}-${dateStr}${ext}`;

  return path.join(destinationPath, dir, newFileName);
}

/**
 * Backs up a single CDA setup file:
 * 1. Computes the destination path.
 * 2. Creates destination directories as needed.
 * 3. Skips the copy if the destination already exists with the same hash.
 * 4. Copies the file.
 */
export function backupFile(
  sourceFile: string,
  sourcePath: string,
  destinationPath: string,
  date: Date = new Date()
): void {
  const destFile = buildDestinationPath(
    sourceFile,
    sourcePath,
    destinationPath,
    date
  );

  // Ensure destination directory exists
  fs.mkdirSync(path.dirname(destFile), { recursive: true });

  // Skip if destination exists and hashes match
  if (fs.existsSync(destFile)) {
    const srcHash = computeFileHash(sourceFile);
    const destHash = computeFileHash(destFile);
    if (srcHash === destHash) {
      console.log(`[SKIP] Identical file already backed up: ${destFile}`);
      return;
    }
  }

  fs.copyFileSync(sourceFile, destFile);
  console.log(`[COPY] ${sourceFile} -> ${destFile}`);
}

/**
 * Runs one full backup pass: finds all CDA-prefixed files in sourcePath and
 * backs them up to destinationPath.
 */
export function runBackup(config: BackupConfig, date: Date = new Date()): void {
  console.log(
    `[INFO] Running backup at ${new Date().toISOString()} ...`
  );

  const cdaFiles = findCdaFiles(config.sourcePath);
  if (cdaFiles.length === 0) {
    console.log("[INFO] No CDA-prefixed setup files found.");
    return;
  }

  for (const file of cdaFiles) {
    backupFile(file, config.sourcePath, config.destinationPath, date);
  }

  console.log(`[INFO] Backup complete. Processed ${cdaFiles.length} file(s).`);
}

/**
 * Starts the backup scheduler. Runs an immediate backup and then repeats
 * every `config.intervalSeconds` seconds.
 *
 * Returns the interval handle so the caller can stop it with clearInterval().
 */
export function startBackupScheduler(config: BackupConfig): ReturnType<typeof setInterval> {
  runBackup(config);
  return setInterval(() => runBackup(config), config.intervalSeconds * 1000);
}

// ---------------------------------------------------------------------------
// Entry point – only executed when running the file directly (not in tests)
// ---------------------------------------------------------------------------
if (require.main === module) {
  // Load .env from the working directory (silent if the file does not exist)
  dotenv.config();

  // CLI args take precedence over environment variables
  const args = process.argv.slice(2);
  const rawSource      = args[0] ?? process.env["SOURCE_PATH"];
  const rawDest        = args[1] ?? process.env["DESTINATION_PATH"];
  const rawInterval    = args[2] ?? process.env["INTERVAL_SECONDS"];

  if (!rawSource || !rawDest || !rawInterval) {
    console.error("Error: SOURCE_PATH, DESTINATION_PATH and INTERVAL_SECONDS must be set.");
    console.error("");
    console.error("Provide them via a .env file (recommended) or as CLI arguments:");
    console.error("  ts-node src/backup.ts <sourcePath> <destinationPath> <intervalSeconds>");
    console.error("");
    console.error("  SOURCE_PATH       – folder where Delta stores setups");
    console.error("  DESTINATION_PATH  – folder where backups will be written");
    console.error("  INTERVAL_SECONDS  – how often to run the backup (in seconds)");
    process.exit(1);
  }

  const intervalSeconds = parseInt(rawInterval, 10);

  if (isNaN(intervalSeconds) || intervalSeconds <= 0) {
    console.error("Error: INTERVAL_SECONDS must be a positive integer.");
    process.exit(1);
  }

  const config: BackupConfig = {
    sourcePath: path.resolve(rawSource),
    destinationPath: path.resolve(rawDest),
    intervalSeconds,
  };

  console.log("[INFO] CDA Backupper started.");
  console.log(`[INFO]   Source      : ${config.sourcePath}`);
  console.log(`[INFO]   Destination : ${config.destinationPath}`);
  console.log(`[INFO]   Interval    : every ${config.intervalSeconds}s`);

  startBackupScheduler(config);
}
