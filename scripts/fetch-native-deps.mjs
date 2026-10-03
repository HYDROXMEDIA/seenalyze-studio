// Downloads the pinned prebuilt libobs engine (obs-studio-node) and, on macOS,
// the preview helper (node-window-rendering) from Streamlabs' official buckets.
// Archives are verified against pinned SHA-256 hashes before extraction.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = path.join(ROOT, "vendor");
const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, "native-deps.json"), "utf8"));
// Bump when the post-install patches below change, so existing installs re-apply them.
const PATCH_LEVEL = "cef-helper-id-1";

/**
 * The engine host runs outside any app bundle, so its embedded browser
 * registers its helper channel with an empty bundle id. The browser helpers
 * look the channel up under their own bundle id, never find it, exit and are
 * relaunched in a tight loop (high CPU). Giving the helpers the same empty id
 * makes the names match. The helpers are re-signed ad hoc locally; release
 * builds are signed again by the packager.
 */
function patchCefHelpers(osnDir) {
  if (process.platform !== "darwin") return;
  const frameworks = path.join(osnDir, "Frameworks");
  const helpers = readdirSync(frameworks).filter((name) => /^obs64 Helper.*\.app$/u.test(name));
  for (const helper of helpers) {
    const bundle = path.join(frameworks, helper);
    execFileSync("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleIdentifier ''", path.join(bundle, "Contents", "Info.plist")]);
    execFileSync("codesign", ["--force", "--sign", "-", "--options", "runtime", "--preserve-metadata=entitlements", bundle], { stdio: "ignore" });
  }
  console.log(`[native-deps] patched ${helpers.length} browser helper(s)`);
}

function platformKey() {
  if (process.platform === "darwin") return process.arch === "arm64" ? "osx-arm64" : "osx";
  if (process.platform === "win32") return "win64";
  return null;
}

async function fetchDependency(dep, key) {
  const target = path.join(VENDOR, dep.name);
  const stamp = path.join(target, ".seenalyze-version");
  const wanted = `${dep.version}-${key}-${PATCH_LEVEL}`;
  if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === wanted) return;

  const archive = dep.archive.replace("[VERSION]", dep.version).replace("[PLATFORM]", key);
  const url = `${dep.url}${archive}`;
  console.log(`[native-deps] downloading ${dep.name} ${wanted}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${dep.name}: download failed (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());

  const digest = createHash("sha256").update(buffer).digest("hex");
  const expected = dep.sha256?.[key];
  if (!expected) {
    throw new Error(`${dep.name}: no pinned sha256 for ${key}. Verify the archive and add "${digest}" to native-deps.json.`);
  }
  if (digest !== expected) throw new Error(`${dep.name}: sha256 mismatch for ${key}`);

  mkdirSync(VENDOR, { recursive: true });
  rmSync(target, { recursive: true, force: true });
  const tmp = path.join(VENDOR, `${dep.name}.tar.gz`);
  writeFileSync(tmp, buffer);
  execFileSync("tar", ["-xzf", tmp, "-C", VENDOR]);
  rmSync(tmp);
  if (dep.name === "obs-studio-node") patchCefHelpers(target);
  writeFileSync(stamp, wanted);
}

async function main() {
  const key = platformKey();
  if (!key) {
    console.warn(`[native-deps] ${process.platform} is not supported; skipping engine download.`);
    return;
  }
  for (const dep of MANIFEST.dependencies) {
    if (dep.platforms.includes(key)) await fetchDependency(dep, key);
  }
}

main().catch((error) => {
  console.error(`[native-deps] ${error.message}`);
  process.exit(1);
});
