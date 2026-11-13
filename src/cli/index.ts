import path from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "../server/index.js";
import { isGitRepo } from "../engine/git.js";

const DEFAULT_PORT = 1806;

async function loadConfig(rootDir: string): Promise<{ port: number }> {
  try {
    const raw = await readFile(path.join(rootDir, ".markless", "config.json"), "utf8");
    const cfg = JSON.parse(raw);
    return {
      port: typeof cfg.port === "number" ? cfg.port : DEFAULT_PORT,
    };
  } catch {
    return { port: DEFAULT_PORT };
  }
}

async function ensureDefaultConfig(rootDir: string): Promise<void> {
  const dir = path.join(rootDir, ".markless");
  const file = path.join(dir, "config.json");
  try {
    await readFile(file, "utf8");
  } catch {
    await mkdir(dir, { recursive: true });
    await writeFile(
      file,
      JSON.stringify({ port: DEFAULT_PORT }, null, 2),
      "utf8",
    );
  }
}

function parseArgs(argv: string[]) {
  let port: number | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" || a === "-p") {
      port = parseInt(argv[++i], 10);
    } else if (a.startsWith("--port=")) {
      port = parseInt(a.slice(7), 10);
    } else {
      positional.push(a);
    }
  }

  return { command: positional[0] ?? "ui", port };
}

function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    void import("node:child_process").then(({ spawn }) => {
      if (platform === "win32") {
        spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
      } else if (platform === "darwin") {
        spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
      } else {
        spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
      }
    });
  } catch {
    // ignore
  }
}

async function cmdUi(rootDir: string, portFlag?: number) {
  const cfg = await loadConfig(rootDir);
  const port = portFlag ?? cfg.port;

  const isRepo = await isGitRepo(rootDir);
  if (!isRepo) {
    console.warn("⚠  Warning: not a git repository. Changes detection may be limited.");
  }

  await ensureDefaultConfig(rootDir);

  const app = createServer({ rootDir, port });

  const server = app.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}`;
    console.log("");
    console.log("  ┌─────────────────────────────────────┐");
    console.log("  │  Markless                           │");
    console.log(`  │  ${url.padEnd(33)}│`);
    console.log("  └─────────────────────────────────────┘");
    console.log("");
    console.log(`  Root: ${rootDir}`);
    console.log("  Press Ctrl+C to stop.");
    console.log("");

    if (process.env.MARKLESS_NO_OPEN !== "1") {
      openBrowser(url);
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Try: markless ui --port ${port + 1}`);
      process.exit(1);
    }
    throw err;
  });

  process.on("SIGINT", () => {
    console.log("\nStopping Markless...");
    server.close(() => process.exit(0));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();

  switch (args.command) {
    case "ui":
      await cmdUi(rootDir, args.port);
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${args.command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
Markless — detect and clean AI marks from changed files

Usage:
  markless ui [options]     Start the web UI (default)
  markless help              Show this help

Options:
  -p, --port <port>         Port (default 1806)

Config file: .markless/config.json in your project root
  { "port": 1806 }
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
