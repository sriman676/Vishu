#!/usr/bin/env node
// One-command install for Vishu — identical on Windows (PowerShell/cmd), Linux/bash, and macOS.
// Run:  node setup.mjs   (or: npm run setup)
// Pure Node so the same command works in every shell; it provisions pnpm, installs, and builds.
import { execSync } from "node:child_process";

const run = (cmd) => {
  process.stdout.write(`\n$ ${cmd}\n`);
  execSync(cmd, { stdio: "inherit" });
};
const has = (cmd) => {
  try {
    execSync(`${cmd} --version`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const major = Number(process.versions.node.split(".")[0]);
process.stdout.write(`Vishu setup · Node ${process.version}\n`);
if (major < 24) process.stdout.write(`⚠ Vishu targets Node ≥ 24 (you have ${process.version}). Continuing, but upgrade if the build fails.\n`);

// 1. Make sure pnpm exists — prefer corepack (bundled with Node), fall back to a global npm install.
if (!has("pnpm")) {
  try {
    run("corepack enable pnpm");
  } catch {
    /* corepack may lack permissions; fall through */
  }
}
if (!has("pnpm")) {
  try {
    run("npm install -g pnpm");
  } catch {
    process.stderr.write("\nCould not install pnpm automatically. Install it (https://pnpm.io/installation), then re-run.\n");
    process.exit(1);
  }
}

// 2. Install workspace deps + build every package.
run("pnpm install");
run("pnpm -r build");

process.stdout.write(
  [
    "",
    "✓ Vishu is installed and built.",
    "",
    "Next:",
    "  1. copy .env.example to .env and paste your API key into VISHU_API_KEY",
    '  2. pnpm vishu chat "hello"      (or: agent / build / serve / eval)',
    "",
    "Optional sidecars (only if you enable those modules): Python+whisper for voice, Rust for the Tauri desktop shell.",
    "",
  ].join("\n"),
);
