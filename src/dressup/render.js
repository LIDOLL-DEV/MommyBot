import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dollLayers } from "./web/layers.js";

export function renderDollPng(snapshot) {
  const executable = process.env.LITTLEPOTTCHI_PYTHON || (process.platform === "win32" ? "py" : "python3");
  const args = !process.env.LITTLEPOTTCHI_PYTHON && process.platform === "win32" ? ["-3.11"] : [];
  args.push(fileURLToPath(new URL("../../python/render_littlepottchi.py", import.meta.url)));
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, { encoding:"buffer", timeout:15000, maxBuffer:4*1024*1024, windowsHide:true }, (error, png) => {
      if (error || !png?.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) reject(new Error("The doll picture could not be rendered. Please try again shortly."));
      else resolve(png);
    });
    child.stdin.on("error", () => {}); // Process failures are reported once through execFile's callback.
    child.stdin.end(JSON.stringify(dollLayers(snapshot)));
  });
} // Run the existing Pillow toolchain without a shell or user-controlled paths; bound both time and output size.
