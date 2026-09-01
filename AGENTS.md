# Agent notes

This repository is a **Foundry VTT module** with **no Node.js toolchain**.

- There is no `package.json`, npm scripts, bundler, or test runner wired up.
- Do **not** run `npm`, `npx`, `yarn`, or `pnpm` unless the project gains a documented `package.json`.
- Validate by code review and testing in Foundry; releases zip the repo in CI without a Node build.

Cursor loads additional guidance from `.cursor/rules/`.

## Code conventions

- Files that manage things take a `manager-` prefix: `manager-playlists.js`.
- Window code takes a `window-` prefix across all three file types: `window-minstrel.js`,
  `window-minstrel.hbs`, `window-minstrel.css`.
- `styles/default.css` only imports other stylesheets. Each window gets its own stylesheet; shared
  rules go in `common.css`.
- Do not create a unique class per element. Reuse classes and patterns.
- Log and notify through Blacksmith's `postConsoleAndNotification`, never `console.log` directly.
- Code for reusability, performance and readability, with intent and specificity.

## Documentation

Documentation layout, naming, and publishing follow the suite-wide standard in Blacksmith's
`documentation/global/global-documentation-standard.md`, which supersedes anything about
documentation here. Run `node tools/check-docs-structure.mjs` after touching `documentation/`.
