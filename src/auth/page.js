import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
export const authStyleSource = `'sha256-${createHash("sha256").update(styles).digest("base64")}'`;
// Authorize only this bundled stylesheet, keeping arbitrary inline styles and scripts blocked.

export function renderAuthPage(body, status) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#fff5fa">
<title>LiDollBot account · LiD0llID</title><style>${styles}</style></head>
<body><div class="auth-shell">
<header class="brand"><span class="brand-sparkle" aria-hidden="true">✦</span><div>LiDollBot<span class="brand-sub">a little connection, a lovely day</span></div></header>
<main aria-labelledby="account-heading">
<div class="palette" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
<p class="eyebrow">Your Discord companion</p>
<h1 id="account-heading">LiDollBot <span>· LiD0llID</span></h1>
<div class="page-content${status >= 400 ? " page-error" : ""}">${body}</div>
<footer>Made for your little corner of Discord.</footer>
</main>
<p class="privacy-note">Your sign-in link and confirmation code are just for you.</p>
</div></body></html>`;
} // Share the tracker's pastel appearance across every bot handoff page; callers escape all dynamic text.
