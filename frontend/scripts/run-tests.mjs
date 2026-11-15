import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testsRoot = resolve(frontendRoot, "tests");

/** Recursively collect *.test.ts paths relative to the frontend workspace. */
function collectTestFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const collected = [];

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      collected.push(...collectTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      collected.push(relative(frontendRoot, fullPath).replaceAll("\\", "/"));
    }
  }

  return collected;
}

const testFiles = collectTestFiles(testsRoot).sort();

if (testFiles.length === 0) {
  console.error(`No *.test.ts files found under ${testsRoot}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const file of testFiles) {
    console.log(file);
  }
  process.exit(0);
}

const result = spawnSync("npx", ["-y", "tsx", "--test", ...args, ...testFiles], {
  cwd: frontendRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
