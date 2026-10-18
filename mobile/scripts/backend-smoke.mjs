// Starts the unchanged backend with an isolated temporary database; never uses .env data.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
const mobile = fileURLToPath(new URL("../", import.meta.url));
const server = createServer();
await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
const port = server.address().port; await new Promise(resolveClose => server.close(resolveClose));
const testDir = await mkdtemp(join(tmpdir(), "person2-smoke-"));
const backend = resolve(mobile, "../backend");
const child = spawn(join(backend, ".venv/bin/python"), ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: backend, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, DATABASE_URL: `sqlite:///${join(testDir, "smoke.db")}`, PARSER_MODE: "mock", NEBIUS_API_KEY: "", API_KEY: "isolated-test-requires-device-auth", STORE_TRANSCRIPTS: "true" },
});
let startupError; child.on("error", error => { startupError = error; });
let logs = ""; child.stderr.on("data", data => { logs += data; });
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw new Error("Backend environment unavailable. Run cd backend && uv sync first.");
    if (child.exitCode !== null) throw new Error(`Backend startup failed: ${logs}`);
    try { ready = (await fetch(`${base}/health`)).ok; } catch {}
    if (ready) break;
    await new Promise(wait => setTimeout(wait, 200));
  }
  if (!ready) throw new Error(`Backend startup timed out: ${logs}`);
  const runner = spawn(process.execPath, [join(mobile, "node_modules/vitest/vitest.mjs"), "run", "tests/backend.integration.test.ts"], {
    cwd: mobile, stdio: "inherit", env: { ...process.env, EXPO_PUBLIC_API_URL: base, EXPO_PUBLIC_USE_MOCKS: "false", EXPO_PUBLIC_API_KEY: "", PERSON2_ISOLATED_DB: "true" },
  });
  process.exitCode = await new Promise((resolveExit, reject) => { runner.once("error", reject); runner.once("exit", code => resolveExit(code ?? 1)); });
} finally {
  child.kill("SIGTERM");
  if (child.exitCode === null) await new Promise(resolveExit => child.once("exit", resolveExit));
  console.log(`Isolated smoke database retained for inspection: ${testDir}`);
}
