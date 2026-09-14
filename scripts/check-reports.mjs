import fs from "node:fs";
import dotenv from "dotenv";
import { ReportClient, ReportConfigurationError, ReportError, reportConfig } from "../src/reports/client.js";

try {
  const settings = dotenv.parse(fs.readFileSync(process.argv[2] || ".env"));
  const config = reportConfig({ ...process.env, ...settings, MOMMYBOT_REPORTS_ENABLED: "true" });
  const page = await new ReportClient(config).list(0, 1);
  console.log(JSON.stringify({ status: "PASS", count: page.reports.length, latestCursor: page.latest_cursor }));
} catch (error) {
  const reason = error instanceof ReportConfigurationError ? error.message : error instanceof ReportError ? error.code : "configuration_unavailable";
  console.error(`FAIL: ${reason}${error instanceof ReportError && error.status ? ` (HTTP ${error.status})` : ""}. Check the protected report settings and tracker admin access.`);
  process.exitCode = 1;
} // Check report-read access without publishing, opening a database, or printing documents and tokens.
