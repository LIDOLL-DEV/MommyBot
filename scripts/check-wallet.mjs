import fs from "node:fs";
import dotenv from "dotenv";
import { WalletClient, WalletError, walletConfig } from "../src/wallet/client.js";

let configured = false;
try {
  const settings = dotenv.parse(fs.readFileSync(process.argv[2] || ".env"));
  const config = walletConfig({ ...process.env, ...settings });
  if (!config) throw new Error("disabled");
  configured = true;
  console.log(JSON.stringify({ node: process.versions.node, api: config.baseUrl, clientId: config.clientId, publicOrigin: config.verificationOrigin }));
  await new WalletClient(config).request("wallet");
  console.error("FAIL: The wallet endpoint unexpectedly accepted a request without a token. Check the API route.");
  process.exitCode = 1;
} catch (error) {
  if (configured && error instanceof WalletError && error.code === "invalid_token" && error.status === 401) {
    console.log("PASS: The wallet API is reachable and recognizes this app. Its authentication rejection is expected: no token was sent. Player consent and spending were not tested.");
  } else {
    console.error(configured && error instanceof WalletError ? `FAIL: ${error.message}` : "FAIL: Check file permissions and the LIDOLLCOIN settings. Online wallets must be enabled and the API URL must be valid.");
    process.exitCode = 1;
  }
} // Probe the configured API with a token-free GET; never create approval codes or read stored wallet credentials.
