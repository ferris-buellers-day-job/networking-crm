import { Router } from "express";
import { execSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

const router = Router();

function getGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    version: pkg.version,
    commit: getGitCommit(),
  });
});

export default router;
