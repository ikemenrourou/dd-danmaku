# Repository Guidelines

## Project layout

This repo is a personal fork of `l429609201/dd-danmaku`. It is intentionally small:

- `ede.js` is the userscript and the main code file.
- `README.md` describes the fork and shows the Bangumi character feature.
- `images/` stores README screenshots.
- `../_ref.l429609201-dd-danmaku/` is the local reference clone of the upstream project. Use it for comparison, but do not edit it as part of this repo.

There is no package manifest, build script, or test runner in this fork right now.

## Working on `ede.js`

Keep changes surgical. This file is installed as a userscript, so avoid broad rewrites, formatting-only churn, or introducing tooling assumptions that are not already in the repo.

Follow the existing style:

- Use plain JavaScript, 4-space indentation, and semicolons where the surrounding code uses them.
- Keep the userscript metadata block at the top valid.
- Preserve compatibility with browser/WebView environments used by Emby pages.
- Treat URLs in the user configuration and API objects carefully; they affect live installations.

## Useful checks

Run a syntax check after editing JavaScript:

```powershell
node --check ede.js
```

Check the working tree before finishing:

```powershell
git status --short
```

If you need to compare against upstream, run commands from this repo and reference the sibling clone explicitly:

```powershell
git diff --no-index ..\_ref.l429609201-dd-danmaku\ede.js .\ede.js
```

## Documentation

Keep `README.md` short and practical. If a feature depends on a screenshot, put the image under `images/` and link to the raw GitHub URL only when the README needs to render outside the repo.

## Git hygiene

Do not overwrite local work. Before making edits, check `git status --short`; if unrelated files are dirty, leave them alone.
