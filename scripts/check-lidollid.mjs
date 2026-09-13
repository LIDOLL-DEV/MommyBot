import fs from "node:fs";
import dotenv from "dotenv";
import { authConfig } from "../src/auth/config.js";
import { createOidc } from "../src/auth/oidc.js";
import { authDiagnostic } from "../src/auth/diagnostics.js";

const file = process.argv[2] || ".env";
let stage = "configuration";
try {
  const settings = dotenv.parse(fs.readFileSync(file));
  const config = authConfig({ ...process.env, ...settings, NODE_ENV: process.env.NODE_ENV || settings.NODE_ENV });
  if (!config) {
    console.error("LiD0llID is disabled. Set LIDOLLID_ENABLED=true in the bot's environment file.");
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ node: process.versions.node, issuer: config.issuer, publicOrigin: config.origin,
      clientId: config.clientId, callback: config.callback }, null, 2));
    stage = "discovery";
    await createOidc(config).begin();
    console.log("PASS: Provider discovery and authorization URL construction succeeded. No login was started; callback registration and token exchange are not checked.");
  }
} catch (error) {
  console.error(`FAIL: ${JSON.stringify(authDiagnostic(error, stage))}`);
  console.error(stage === "configuration" ? "Check that this user can read the environment file and that its LIDOLLID settings are valid." : "Check issuer spelling, DNS, HTTPS certificates and outbound access from this bot host. Do not disable TLS or issuer verification.");
  process.exitCode = 1;
} // Diagnose the same OIDC discovery as the bot using only metadata requests; never print the environment file or generated login URL.
