import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  getTodayDateString,
  computeFileHash,
  findCdaFiles,
  buildDestinationPath,
  backupFile,
  runBackup,
  BackupConfig,
} from "./backup";

// ---------------------------------------------------------------------------
// Helper: create a temporary directory for each test
// ---------------------------------------------------------------------------
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cda-test-"));
}

function rmDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Fixed date used across tests so results are deterministic
const FIXED_DATE = new Date("2024-06-15T12:00:00Z");
const FIXED_DATE_STR = "20240615";

// ---------------------------------------------------------------------------
// getTodayDateString
// ---------------------------------------------------------------------------
describe("getTodayDateString", () => {
  it("formats a date as YYYYMMDD", () => {
    expect(getTodayDateString(FIXED_DATE)).toBe(FIXED_DATE_STR);
  });

  it("zero-pads month and day", () => {
    expect(getTodayDateString(new Date("2024-01-05T00:00:00Z"))).toBe(
      "20240105"
    );
  });
});

// ---------------------------------------------------------------------------
// computeFileHash
// ---------------------------------------------------------------------------
describe("computeFileHash", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmDir(tmpDir);
  });

  it("returns the same hash for identical content", () => {
    const a = path.join(tmpDir, "a.txt");
    const b = path.join(tmpDir, "b.txt");
    fs.writeFileSync(a, "hello world");
    fs.writeFileSync(b, "hello world");
    expect(computeFileHash(a)).toBe(computeFileHash(b));
  });

  it("returns different hashes for different content", () => {
    const a = path.join(tmpDir, "a.txt");
    const b = path.join(tmpDir, "b.txt");
    fs.writeFileSync(a, "hello");
    fs.writeFileSync(b, "world");
    expect(computeFileHash(a)).not.toBe(computeFileHash(b));
  });
});

// ---------------------------------------------------------------------------
// findCdaFiles
// ---------------------------------------------------------------------------
describe("findCdaFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmDir(tmpDir);
  });

  it("returns empty array for non-existent directory", () => {
    expect(findCdaFiles(path.join(tmpDir, "missing"))).toEqual([]);
  });

  it("finds CDA-prefixed files in root directory", () => {
    fs.writeFileSync(path.join(tmpDir, "CDASetup.ini"), "data");
    fs.writeFileSync(path.join(tmpDir, "other.ini"), "data");
    const found = findCdaFiles(tmpDir);
    expect(found).toHaveLength(1);
    expect(path.basename(found[0])).toBe("CDASetup.ini");
  });

  it("finds CDA-prefixed files recursively in subdirectories", () => {
    const carDir = path.join(tmpDir, "Ferrari488GT3", "Spa");
    fs.mkdirSync(carDir, { recursive: true });
    fs.writeFileSync(path.join(carDir, "CDAQualifying.ini"), "data");
    fs.writeFileSync(path.join(carDir, "notcda.ini"), "data");

    const found = findCdaFiles(tmpDir);
    expect(found).toHaveLength(1);
    expect(path.basename(found[0])).toBe("CDAQualifying.ini");
  });

  it("does not include directories themselves", () => {
    const cdaDir = path.join(tmpDir, "CDASubDir");
    fs.mkdirSync(cdaDir);
    expect(findCdaFiles(tmpDir)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildDestinationPath
// ---------------------------------------------------------------------------
describe("buildDestinationPath", () => {
  const srcBase = "/setups";
  const dstBase = "/backup";

  it("strips CDA prefix and adds date postfix before extension", () => {
    const src = "/setups/Ferrari488GT3/Spa/CDAQualifying.ini";
    const result = buildDestinationPath(src, srcBase, dstBase, FIXED_DATE);
    expect(result).toBe(
      `/backup/Ferrari488GT3/Spa/Qualifying-${FIXED_DATE_STR}.ini`
    );
  });

  it("handles files with no extension", () => {
    const src = "/setups/Ferrari488GT3/Spa/CDASetup";
    const result = buildDestinationPath(src, srcBase, dstBase, FIXED_DATE);
    expect(result).toBe(
      `/backup/Ferrari488GT3/Spa/Setup-${FIXED_DATE_STR}`
    );
  });

  it("preserves nested directory structure", () => {
    const src = "/setups/car/track/CDASetup.json";
    const result = buildDestinationPath(src, srcBase, dstBase, FIXED_DATE);
    expect(result).toContain(`/backup/car/track/`);
  });
});

// ---------------------------------------------------------------------------
// backupFile
// ---------------------------------------------------------------------------
describe("backupFile", () => {
  let srcDir: string;
  let dstDir: string;

  beforeEach(() => {
    srcDir = makeTmpDir();
    dstDir = makeTmpDir();
  });

  afterEach(() => {
    rmDir(srcDir);
    rmDir(dstDir);
  });

  it("copies a CDA file to the destination with correct name", () => {
    const srcFile = path.join(srcDir, "CDASetup.ini");
    fs.writeFileSync(srcFile, "setup-data");

    backupFile(srcFile, srcDir, dstDir, FIXED_DATE);

    const expectedDest = path.join(dstDir, `Setup-${FIXED_DATE_STR}.ini`);
    expect(fs.existsSync(expectedDest)).toBe(true);
    expect(fs.readFileSync(expectedDest, "utf8")).toBe("setup-data");
  });

  it("creates nested destination directories automatically", () => {
    const carDir = path.join(srcDir, "BMW", "Monza");
    fs.mkdirSync(carDir, { recursive: true });
    const srcFile = path.join(carDir, "CDAQual.ini");
    fs.writeFileSync(srcFile, "qual-data");

    backupFile(srcFile, srcDir, dstDir, FIXED_DATE);

    const expectedDest = path.join(
      dstDir,
      "BMW",
      "Monza",
      `Qual-${FIXED_DATE_STR}.ini`
    );
    expect(fs.existsSync(expectedDest)).toBe(true);
  });

  it("does not overwrite destination file when hashes match", () => {
    const srcFile = path.join(srcDir, "CDASetup.ini");
    fs.writeFileSync(srcFile, "identical-content");

    // Pre-populate destination with the same content
    const destFile = path.join(dstDir, `Setup-${FIXED_DATE_STR}.ini`);
    fs.writeFileSync(destFile, "identical-content");

    const mtimeBefore = fs.statSync(destFile).mtimeMs;
    // Small pause to ensure mtime would differ if file were overwritten
    backupFile(srcFile, srcDir, dstDir, FIXED_DATE);
    const mtimeAfter = fs.statSync(destFile).mtimeMs;

    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it("overwrites destination file when hashes differ", () => {
    const srcFile = path.join(srcDir, "CDASetup.ini");
    fs.writeFileSync(srcFile, "new-content");

    const destFile = path.join(dstDir, `Setup-${FIXED_DATE_STR}.ini`);
    fs.writeFileSync(destFile, "old-content");

    backupFile(srcFile, srcDir, dstDir, FIXED_DATE);

    expect(fs.readFileSync(destFile, "utf8")).toBe("new-content");
  });
});

// ---------------------------------------------------------------------------
// runBackup (integration)
// ---------------------------------------------------------------------------
describe("runBackup", () => {
  let srcDir: string;
  let dstDir: string;

  beforeEach(() => {
    srcDir = makeTmpDir();
    dstDir = makeTmpDir();
  });

  afterEach(() => {
    rmDir(srcDir);
    rmDir(dstDir);
  });

  function makeConfig(): BackupConfig {
    return {
      sourcePath: srcDir,
      destinationPath: dstDir,
      intervalSeconds: 60,
    };
  }

  it("backs up multiple CDA files preserving directory structure", () => {
    const car1 = path.join(srcDir, "Ferrari488GT3", "Spa");
    const car2 = path.join(srcDir, "BMW_M4", "Monza");
    fs.mkdirSync(car1, { recursive: true });
    fs.mkdirSync(car2, { recursive: true });

    fs.writeFileSync(path.join(car1, "CDAQual.ini"), "spa-qual");
    fs.writeFileSync(path.join(car1, "CDARace.ini"), "spa-race");
    fs.writeFileSync(path.join(car2, "CDASetup.ini"), "monza-setup");
    // Non-CDA file should be ignored
    fs.writeFileSync(path.join(car2, "other.ini"), "ignored");

    runBackup(makeConfig(), FIXED_DATE);

    expect(
      fs.existsSync(
        path.join(dstDir, "Ferrari488GT3", "Spa", `Qual-${FIXED_DATE_STR}.ini`)
      )
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(dstDir, "Ferrari488GT3", "Spa", `Race-${FIXED_DATE_STR}.ini`)
      )
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(dstDir, "BMW_M4", "Monza", `Setup-${FIXED_DATE_STR}.ini`)
      )
    ).toBe(true);
    expect(
      fs.existsSync(path.join(dstDir, "BMW_M4", "Monza", "other.ini"))
    ).toBe(false);
  });

  it("does nothing when no CDA files are present", () => {
    fs.writeFileSync(path.join(srcDir, "regular.ini"), "data");
    runBackup(makeConfig(), FIXED_DATE);
    expect(fs.readdirSync(dstDir)).toHaveLength(0);
  });
});
