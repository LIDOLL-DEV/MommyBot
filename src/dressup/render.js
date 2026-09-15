import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dollLayers } from "./web/layers.js";
import { fittingProfiles } from "./fitting.js";
import { loadDressupCatalog } from "./catalog.js";

const failures = {
  python_missing:"Python could not be started. Install Python 3 or set LITTLEPOTTCHI_PYTHON to its executable path.",
  pillow_missing:"Pillow is missing from the renderer's Python environment. On Fedora install python3-pillow; custom interpreters need Pillow in their own environment.",
  pillow_old:"The renderer needs Pillow 9.1 or newer. Update Pillow in the configured Python environment.",
  renderer_missing:"The release is missing python/render_littlepottchi.py. Redeploy the complete application.",
  asset_missing:"A doll PNG asset is missing from this release. Check assets/dressup and redeploy the complete application.",
  permission:"The bot account cannot access the PNG renderer or its assets. Check service-account file permissions.",
  timeout:"PNG rendering exceeded its 15-second limit. Check renderer resources on the bot host.",
  invalid_png:"The PNG renderer returned invalid image data. Check the configured Python executable and renderer installation.",
  failed:"PNG rendering failed. Check Python/Pillow and run scripts/check-doll-render.mjs as the bot account.",
};
export class DollRenderError extends Error {
  constructor(code) { super(failures[code] || failures.failed); this.name="DollRenderError"; this.code=Object.hasOwn(failures,code) ? code : "failed"; }
} // Operator diagnostics are fixed text; Python stderr, paths and environment values never reach public replies or logs.

function failureCode(error, stderr) {
  const text = String(stderr || "");
  if (error.code === "ENOENT") return "python_missing";
  if (error.code === "EACCES" || /PermissionError:/.test(text)) return "permission";
  if (/No module named ['"]PIL['"]/.test(text)) return "pillow_missing";
  if (/AttributeError:.*Resampling/.test(text)) return "pillow_old";
  if (/can't open file.*render_littlepottchi\.py/.test(text)) return "renderer_missing";
  if (/FileNotFoundError:/.test(text)) return "asset_missing";
  if (error.killed) return "timeout";
  return "failed";
} // Distinguish missing setup from bad release contents without echoing untrusted process output.

export function renderDollPng(snapshot, execute = execFile) {
  if (!snapshot.fitProfiles) snapshot = { ...snapshot, fitProfiles: fittingProfiles(snapshot, loadDressupCatalog()) };
  const executable = process.env.LITTLEPOTTCHI_PYTHON || (process.platform === "win32" ? "py" : "python3");
  const args = !process.env.LITTLEPOTTCHI_PYTHON && process.platform === "win32" ? ["-3.11"] : [];
  args.push(fileURLToPath(new URL("../../python/render_littlepottchi.py", import.meta.url)));
  return new Promise((resolve, reject) => {
    const child = execute(executable, args, { encoding:"buffer", timeout:15000, maxBuffer:4*1024*1024, windowsHide:true }, (error, png, stderr) => {
      if (error) reject(new DollRenderError(failureCode(error, stderr)));
      else if (!png?.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) reject(new DollRenderError("invalid_png"));
      else resolve(png);
    });
    child.stdin.on("error", () => {}); // Process failures are reported once through execFile's callback.
    child.stdin.end(JSON.stringify(dollLayers(snapshot)));
  });
} // Run the existing Pillow toolchain without a shell or user-controlled paths; bound both time and output size.
