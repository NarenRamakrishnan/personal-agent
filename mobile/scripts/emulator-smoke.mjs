// UI acceptance only on the dedicated disposable emulator package, never a phone.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
const run = promisify(execFile);
const serial = process.env.PERSON2_ADB_SERIAL ?? "emulator-5554";
if (!/^emulator-\d+$/.test(serial)) throw new Error("This test refuses physical-device serials.");
const bridge = join(process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk"), "platform-tools/adb");
const pkg = "com.contextassistant.emulatortest";
const delaySeconds = Number(process.env.PERSON2_TIMER_SECONDS ?? 120);
if (!Number.isInteger(delaySeconds) || delaySeconds < 30 || delaySeconds > 180) throw new Error("Timer must be between 30 and 180 seconds.");
const adb = async (...args) => {
  try { return (await run(bridge, ["-s", serial, ...args], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 })).stdout; }
  catch (error) {
    // Android can return 255 after emitting a partial notification-service snapshot.
    // Keep polling/inspect its emitted state; never mask other commands or ADB errors.
    if (args[1] === "dumpsys" && args[2] === "notification" && error.code === 255 && error.stdout?.includes("Current Notification Manager state:")) return error.stdout;
    throw error;
  }
};
if ((await adb("shell", "getprop", "ro.kernel.qemu")).trim() !== "1") throw new Error("Target is not an emulator.");
const decode = text => text.replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
async function screen() {
  await adb("shell", "uiautomator", "dump", "/sdcard/heedly-acceptance.xml");
  const xml = await adb("shell", "cat", "/sdcard/heedly-acceptance.xml");
  return [...xml.matchAll(/<node\s[^>]+/g)].map(tag => Object.fromEntries([...tag[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], decode(match[2])])));
}
async function tap(label) {
  const nodes = await screen();
  const found = nodes.find(node => node["content-desc"] === label) ?? nodes.find(node => node.text === label);
  if (!found) throw new Error(`Control not visible: ${label}`);
  const bounds = found.bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/).slice(1).map(Number);
  await adb("shell", "input", "tap", String(Math.floor((bounds[0] + bounds[2]) / 2)), String(Math.floor((bounds[1] + bounds[3]) / 2)));
}
async function assertText(text) {
  const start = Date.now();
  while (Date.now() - start < 15000) { if ((await screen()).some(node => (node.text || node["content-desc"] || "").includes(text))) return; }
  throw new Error(`Expected native text: ${text}`);
}
async function fill(label, value) {
  await tap(label); await adb("shell", "input", "keyevent", "123");
  await adb("shell", "input", "keyevent", ...Array(80).fill("67"));
  await adb("shell", "input", "text", value.replaceAll(" ", "%s")); await adb("shell", "input", "keyevent", "4");
}
async function screenshot(name) {
  const directory = new URL("../test-results/emulator/", import.meta.url); await mkdir(directory, { recursive: true });
  const { stdout } = await run(bridge, ["-s", serial, "exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
  await writeFile(new URL(name, directory), stdout);
}
async function dismissDeveloperMenu() {
  if ((await screen()).some(node => node.text === "Continue")) await tap("Continue");
  if ((await screen()).some(node => node["content-desc"] === "Close" || node.text === "Close")) await tap("Close");
}
await adb("reverse", "tcp:8081", "tcp:8081");
await adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", "exp+context-aware-personal-assistant://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081", pkg);
await dismissDeveloperMenu();
await assertText("Your reminders");
if (process.argv.includes("--check-restart")) {
  await assertText("Emulator timed check"); await screenshot("restart-persistence.png");
  console.log("PASS: native identity and prior timed reminder survived force-stop/restart."); process.exit(0);
}
await tap("Enable reminder notifications");
const prompt = await screen(); if (prompt.some(node => node.text === "Allow")) await tap("Allow");
await tap("Check notification timing");
await screenshot("timing-before-grant.png");
// Grant only this disposable emulator app. The real user-facing settings flow
// remains manual; no host/phone permission or other app is changed.
await adb("shell", "appops", "set", pkg, "SCHEDULE_EXACT_ALARM", "allow");
await tap("Check notification timing"); await assertText("Exact-time scheduling is allowed");
console.log("PASS: native startup, notification permission and exact-alarm status after emulator-only grant.");
await tap("Add reminder"); await tap("What should I remember?");
await adb("shell", "input", "text", "Remind%sme%sin%s2%sminutes%sto%sverify%semulator");
await adb("shell", "input", "keyevent", "4");
await tap("Review reminder"); await assertText("Confirm reminder");
// The isolated backend's mock parser deliberately returns a fixed one-hour date.
// Review/edit the date explicitly: this tests native delivery, not live LLM quality.
const expectedTitle = `Emulator timed check ${Date.now()}`;
await fill("Title", expectedTitle);
await fill("Deadline (ISO date with timezone, or leave empty)", new Date(Date.now() + delaySeconds * 1000).toISOString());
await tap("Save reminder");
const nodes = await screen(); const reminder = nodes.find(node => node["content-desc"] === `Open reminder: ${expectedTitle}`);
if (!reminder) throw new Error("Created reminder not visible in native list.");
const title = reminder["content-desc"].slice("Open reminder: ".length);
await screenshot("native-reminder.png");
await adb("shell", "input", "keyevent", "3");
console.log(`PASS: native text → parse → confirm → save. App backgrounded; waiting for the reviewed ${delaySeconds}-second notification.`);
const started = Date.now(); let notified = false;
while (Date.now() - started < (delaySeconds + 35) * 1000) {
  const dump = await adb("shell", "dumpsys", "notification", "--noredact");
  if (dump.includes(`android.text=String (${title})`)) { notified = true; break; }
  await new Promise(done => setTimeout(done, 3000));
}
if (!notified) throw new Error("Reviewed timed notification was not observed in the Android notification service.");
await adb("shell", "cmd", "statusbar", "expand-notifications"); await new Promise(done => setTimeout(done, 1000)); await screenshot("delivered-notification.png");
console.log(`PASS: Android posted the timed notification while the app was backgrounded (${Math.round((Date.now() - started) / 1000)} s after backgrounding).`);
await adb("shell", "cmd", "statusbar", "collapse");
await adb("shell", "am", "force-stop", pkg);
await adb("reverse", "tcp:8081", "tcp:8081");
await adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", "exp+context-aware-personal-assistant://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081", pkg);
await dismissDeveloperMenu();
await assertText(title); console.log("PASS: native device identity and reminder survived app restart.");
console.log("Microphone, real geofence travel, battery and iOS behavior are not verified by this test.");
