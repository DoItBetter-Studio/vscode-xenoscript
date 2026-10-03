# XenoScript for VS Code

Language support for [XenoScript](https://github.com/DoItBetter-Studio/XenoScript) — the statically typed modding scripting language used for game and toolchain scripting.

## Overview

This extension adds first-class editing support for `.xeno` files in VS Code, including syntax highlighting, semantic navigation, and live diagnostics powered by the bundled `xenolsp` language server.

## Features

- Syntax highlighting for `.xeno` files
- Hover type information at the cursor
- Go to Definition for symbols and declarations
- Find All References in the current file
- Live diagnostics with incremental parsing so errors stay visible while typing
- Project build command for XenoScript files
- Language server restart command to reload the backend after updates

## Requirements

- VS Code 1.82 or newer
- A working `xenolsp` binary

This extension looks for the language server in the following order:

1. Custom `xenoscript.lspPath` / platform-specific overrides
2. `xenoscript.toolchainRoot`
3. Bundled `bin/xenolsp` or `bin/xenolsp.exe`
4. `xenolsp` on your `PATH`

## Installation

### Install from VSIX

1. Download the `.vsix` package from the releases page or build it locally.
2. Open VS Code.
3. Go to Extensions.
4. Open the Command Palette and run `Extensions: Install from VSIX...`.
5. Select the `.vsix` file.

### Build from source

```bash
cd vscode-xenoscript
npm install
npm run compile
# Copy xenolsp[.exe] into bin/
cp ../bin/xenolsp bin/
# or on Windows: copy ..\bin\xenolsp.exe bin\
npx vsce package
```

This produces a package like `vscode-xenoscript-x.y.z.vsix`.

## Extension Settings

| Setting | Description |
|---|---|
| `xenoscript.lspPath` | Absolute path to the `xenolsp` binary. Useful when you want to use a game or SDK-provided toolchain instead of the bundled one. |
| `xenoscript.lspPathWindows` | Windows-only override for the language server path. |
| `xenoscript.lspPathLinux` | Linux-only override for the language server path. |
| `xenoscript.toolchainRoot` | Root path for a XenoScript toolchain or game install; the extension will look for `tools/xenolsp` or `bin/xenolsp` under it. |
| `xenoscript.trace.server` | Enables tracing for VS Code ↔ language server communication (`off`, `messages`, or `verbose`). |

## Commands

| Command | Description |
|---|---|
| `XenoScript: Restart Language Server` | Stops and relaunches `xenolsp` so the newest binary or config is used. |
| `XenoScript: Show Language Server Path` | Displays the resolved path to the active `xenolsp` binary. |
| `XenoScript: Build Project` | Runs the project build action for the current XenoScript file. |

## Troubleshooting

If the language features are not working, try the following:

- Confirm the `xenolsp` binary exists and is executable.
- Check the resolved language server path with `XenoScript: Show Language Server Path`.
- Restart the language server with `XenoScript: Restart Language Server`.
- If needed, set `xenoscript.lspPath` or `xenoscript.toolchainRoot` explicitly.

## Development

```bash
npm install
npm run watch
```

Use the built-in VS Code extension host for debugging, or package the extension with `npx vsce package` when ready to distribute.

## License

This project is licensed under the terms in the [LICENSE](LICENSE) file.
