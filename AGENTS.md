# Agent notes

This repository is a **Foundry VTT module** with **no Node.js toolchain**.

- There is no `package.json`, npm scripts, bundler, or test runner wired up.
- Do **not** run `npm`, `npx`, `yarn`, or `pnpm` unless the project gains a documented `package.json`.
- Validate by code review and testing in Foundry; releases zip the repo in CI without a Node build.

Cursor loads additional guidance from `.cursor/rules/`.
