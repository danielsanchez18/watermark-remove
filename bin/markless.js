#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const entry = path.join(root, "src", "cli", "index.ts");

// Resolve tsx from markless's own node_modules (works even when cwd is another project)
const tsxLoader = path.join(root, "node_modules", "tsx", "dist", "loader.mjs");
const tsxCjs = path.join(root, "node_modules", "tsx", "dist", "cjs", "index.cjs");

let child;
if (existsSync(tsxLoader)) {
  child = spawn(
    process.execPath,
    ["--import", `file://${tsxLoader.replace(/\\/g, "/")}`, entry, ...process.argv.slice(2)],
    { stdio: "inherit", cwd: process.cwd(), env: process.env },
  );
} else {
  // Fallback: run via node --experimental-strip-types or spawn tsx bin
  const tsxBin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  child = spawn(tsxBin, [entry, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: { ...process.env, NODE_PATH: path.join(root, "node_modules") },
  });
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
