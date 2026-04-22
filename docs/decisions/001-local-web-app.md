# ADR 001: Local web app over desktop framework

**Status:** Accepted
**Date:** 2026-04-22

## Context
The CRM needs a UI that runs on David's MacBook. Three viable shells were considered: a desktop app (Electron or Tauri), a local web app (Node + Express serving a React bundle, accessed via browser), or a command-line tool.

## Decision
Build a local web app: Node + Express + React + Vite, launched with `npm run dev`, opened in the default browser at `http://localhost:3000`. No desktop packaging.

## Consequences
**Easier:** fastest possible setup; no code-signing or notarization; excellent Claude Code support; trivial to inspect with browser devtools.

**Harder:** requires a Terminal command to launch; no native OS integrations without extra work.

**New risks:** accidentally exposing the server beyond localhost if misconfigured — mitigated by binding Express explicitly to `127.0.0.1`.

## Alternatives considered
- **Electron:** mature but heavyweight; packaging and signing complexity unwarranted for a single-user tool.
- **Tauri:** lighter than Electron (Rust-based) but smaller Claude Code training data and adds a second toolchain.
- **Command-line tool:** fastest to build, but data entry for long notes in a terminal is unpleasant.

A future migration to Tauri is feasible if David later wants a true desktop feel.
