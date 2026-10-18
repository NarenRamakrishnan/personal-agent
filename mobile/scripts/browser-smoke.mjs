// Connected browser tests against temporary local data; never reads developer .env values.
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createSocket } from "node:net";
const mobile = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "person2-browser-"));
const backend = resolve(mobile, "../backend");
const reservation = createSocket(); await new Promise(done => reservation.listen(0, "127.0.0.1", done));
const port = reservation.address().port; await new Promise(done => reservation.close(done));
const apiURL = `http://127.0.0.1:${port}`;
const env = { ...process.env, EXPO_NO_DOTENV: "1", EXPO_NO_TELEMETRY: "1", EXPO_PUBLIC_USE_MOCKS: "false", EXPO_PUBLIC_API_URL: apiURL, EXPO_PUBLIC_API_KEY: "", EXPO_PUBLIC_PLACES_URL: "https://places.invalid/interpreter" };
const children = new Set();
function child(command, args, options = {}) { const process = spawn(command, args, { cwd: mobile, stdio: "inherit", env, ...options }); children.add(process); process.once("exit", () => children.delete(process)); return process; }
function completed(process) { return new Promise((done, reject) => { process.once("error", reject); process.once("exit", code => code === 0 ? done() : reject(new Error(`Child command failed (${code}).`))); }); }
let staticServer;
try {
  const api = child(join(backend, ".venv/bin/python"), ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port)], { cwd: backend, stdio: "ignore", env: { ...env, DATABASE_URL: `sqlite:///${join(temporary, "browser.db")}`, PARSER_MODE: "mock", NEBIUS_API_KEY: "", API_KEY: "isolated-browser-auth-required", STORE_TRANSCRIPTS: "true" } });
  let ready = false;
  for (let i = 0; i < 100; i++) { if (api.exitCode !== null) throw new Error("Isolated backend could not start."); try { ready = (await fetch(`${apiURL}/health`)).ok; } catch {} if (ready) break; await new Promise(done => setTimeout(done, 200)); }
  if (!ready) throw new Error("Isolated backend startup timed out.");
  const web = join(temporary, "web");
  await completed(child(process.execPath, [join(mobile, "node_modules/expo/bin/cli"), "export", "--clear", "--platform", "web", "--output-dir", web]));
  const mime = { ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ttf": "font/ttf" };
  staticServer = createServer(async (request, response) => {
    try {
      const path = resolve(web, `.${decodeURIComponent(new URL(request.url, "http://localhost").pathname)}`);
      if (path !== web && !path.startsWith(web + sep)) { response.writeHead(403).end(); return; }
      const target = path === web ? join(web, "index.html") : path;
      const body = await readFile(target).catch(error => { if (!extname(target)) return readFile(join(web, "index.html")); throw error; });
      response.writeHead(200, { "Content-Type": mime[extname(target)] ?? "application/octet-stream" }).end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => staticServer.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${staticServer.address().port}`;
  console.log(`Isolated browser preview: ${url}`);
  if (process.argv.includes("--preview")) {
    console.log(`Temporary API for emulator: http://10.0.2.2:${port}`);
    console.log("Preview uses test data and mock parsing, not your hosted backend. Stop with Ctrl+C.");
    await new Promise(done => { process.once("SIGINT", done); process.once("SIGTERM", done); });
  } else await completed(child(process.execPath, [join(mobile, "node_modules/@playwright/test/cli.js"), "test"], { env: { ...env, PERSON2_BROWSER_URL: url, PERSON2_TEST_API: apiURL } }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (staticServer) await new Promise(done => staticServer.close(done));
  await Promise.all([...children].map(process => new Promise(done => { if (process.exitCode !== null) return done(); process.once("exit", done); process.kill("SIGTERM"); })));
  console.log(`Temporary browser test data retained: ${temporary}. Test servers stopped.`);
}
