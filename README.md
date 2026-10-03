# XenoScript for VS Code

Language support for [XenoScript](https://github.com/DoItBetter-Studio/XenoScript) — the statically-typed modding scripting language.

## Features

- **Syntax highlighting** for `.xeno` files
- **Hover** — type information at the cursor
- **Go to Definition** — jump to where a symbol is declared; XAR-bundled classes open as read-only stubs
- **Find All References** — every usage of a symbol in the current file
- **Live diagnostics** — type errors underlined as you type, using the last-good parse state so errors never clear the screen

## Requirements

The extension bundles the `xenolsp` language server binary. On Linux the binary is `bin/xenolsp`; on Windows it is `bin/xenolsp.exe`. If the bundled binary is missing, the extension falls back to searching `xenolsp` on your `PATH`.

## Extension Settings

None yet. Future versions will expose settings for custom stdlib paths and diagnostic severity.

## Commands

| Command | Description |
|---|---|
| `XenoScript: Restart Language Server` | Kills and relaunches `xenolsp` — useful after updating the binary |

## Building from source

```bash
cd vscode-xenoscript
npm install
npm run compile
# Copy xenolsp[.exe] into bin/
cp ../bin/xenolsp bin/
npx vsce package   # produces vscode-xenoscript-x.y.z.vsix
```

Install the `.vsix` via **Extensions → … → Install from VSIX**.
