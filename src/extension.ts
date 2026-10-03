/**
 * extension.ts — XenoScript VS Code Extension
 *
 * Responsibilities:
 *   1. Locate the `xenolsp` binary (settings → env → workspace/game tree → bundled → PATH)
 *   2. Launch it as a Language Server and wire up the LSP client
 *   3. Register a TextDocumentContentProvider for the `xeno-stub:` URI scheme
 *   4. Build command: run `xenoc build` from the same tools/ folder as xenolsp
 *
 * Each game embeds its own xenolsp (with its own stdlib). Prefer that binary
 * via auto-detection or `xenoscript.lspPath`.
 */

/// <reference types="node" />

import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  Executable,
  TransportKind,
} from "vscode-languageclient/node";

// ── Globals ──────────────────────────────────────────────────────────────────

let client: LanguageClient | undefined;

/** How the active xenolsp binary was found (for status bar / logs). */
let resolvedServerSource = "";

/** Absolute path to the last resolved xenolsp binary. */
let resolvedServerPath = "";

const stubContentCache = new Map<string, string>();

// ── Activation ───────────────────────────────────────────────────────────────

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const serverPath = resolveServerPath(context);
  if (!serverPath) {
    vscode.window.showErrorMessage(
      "XenoScript: could not find `xenolsp`. " +
        "Open a game/mod workspace that contains tools/xenolsp, " +
        "set `xenoscript.lspPath`, set XENOLSP, or put xenolsp on PATH.",
    );
    return;
  }
  resolvedServerPath = serverPath;

  const serverExecutable: Executable = {
    command: serverPath,
    transport: TransportKind.stdio,
    options: {
      env: {
        ...process.env,
        ...(process.env.XENO_ROOT
          ? {}
          : { XENO_ROOT: inferXenoRoot(serverPath) ?? "" }),
      },
    },
  };

  const serverOptions: ServerOptions = {
    run: serverExecutable,
    debug: serverExecutable,
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "xenoscript" }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.xeno"),
    },
    middleware: {
      provideDefinition: async (document, position, token, next) => {
        const result = await next(document, position, token);
        if (!result) return result;
        if (!client) return result;

        const locations = Array.isArray(result) ? result : [result];

        for (const loc of locations) {
          const anyLoc = loc as any;
          const uriStr: string | undefined =
            anyLoc.targetUri?.toString?.() ??
            anyLoc.uri?.toString?.() ??
            anyLoc.uri;

          if (uriStr && uriStr.startsWith("xeno-stub:")) {
            try {
              const className = uriStr.replace(/^xeno-stub:\/+/, "");
              const stub = await client.sendRequest<string>("xeno/getStub", {
                name: className,
              });
              if (typeof stub === "string") {
                stubContentCache.set(uriStr, stub);
              }
            } catch (err) {
              console.error("Failed to fetch stub:", err);
            }
          }
        }

        return result;
      },
    },
  };

  client = new LanguageClient(
    "xenoscript",
    "XenoScript Language Server",
    serverOptions,
    {
      ...clientOptions,
      traceOutputChannel: vscode.window.createOutputChannel("XenoScript LSP"),
      diagnosticCollectionName: "xenoscript",
    },
  );

  await client.start();

  const stubProvider = new XenoStubContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "xeno-stub",
      stubProvider,
    ),
  );

  const statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusItem.text = "$(symbol-class) XenoScript";
  statusItem.tooltip = `XenoScript LSP\n${serverPath}\n(${resolvedServerSource})`;
  statusItem.show();
  context.subscriptions.push(statusItem);

  // Build button on the status bar
  const buildItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99,
  );
  buildItem.text = "$(package) Xeno Build";
  buildItem.tooltip = "Build the XenoScript project (xenoc build)";
  buildItem.command = "xenoscript.buildProject";
  buildItem.show();
  context.subscriptions.push(buildItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("xenoscript.restartServer", async () => {
      await client?.stop();
      await client?.start();
      vscode.window.showInformationMessage(
        "XenoScript language server restarted.",
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("xenoscript.showLspPath", () => {
      vscode.window.showInformationMessage(
        `xenolsp: ${resolvedServerPath} (${resolvedServerSource})`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("xenoscript.buildProject", () =>
      buildXenoProject(),
    ),
  );
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
}

// ── Build project ─────────────────────────────────────────────────────────────

function toolSibling(serverPath: string, toolBase: string): string | undefined {
  const dir = path.dirname(serverPath);
  const ext = process.platform === "win32" ? ".exe" : "";
  const candidate = path.join(dir, `${toolBase}${ext}`);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }
  return undefined;
}

/** Walk from startDir upward looking for xeno.project. */
function findProjectRoot(startDir: string, maxLevels = 10): string | undefined {
  let dir = path.resolve(startDir);
  for (let i = 0; i < maxLevels; i++) {
    const marker = path.join(dir, "xeno.project");
    if (fs.existsSync(marker)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function resolveProjectRootForBuild(): string | undefined {
  // Prefer the folder of the active editor
  const active = vscode.window.activeTextEditor?.document;
  if (active && active.uri.scheme === "file") {
    const fromFile = findProjectRoot(path.dirname(active.uri.fsPath));
    if (fromFile) return fromFile;
  }

  // Then each workspace folder
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== "file") continue;
    const found = findProjectRoot(folder.uri.fsPath);
    if (found) return found;
  }

  return undefined;
}

async function buildXenoProject(): Promise<void> {
  const projectRoot = resolveProjectRootForBuild();
  if (!projectRoot) {
    vscode.window.showErrorMessage(
      "XenoScript: no xeno.project found. Open a mod folder or a file inside a project.",
    );
    return;
  }

  if (!resolvedServerPath) {
    vscode.window.showErrorMessage(
      "XenoScript: language server path unknown; cannot locate xenoc.",
    );
    return;
  }

  const xenoc = toolSibling(resolvedServerPath, "xenoc");
  if (!xenoc) {
    vscode.window.showErrorMessage(
      `XenoScript: xenoc not found next to xenolsp (${path.dirname(resolvedServerPath)}).`,
    );
    return;
  }

  const out = vscode.window.createOutputChannel("XenoScript Build");
  out.clear();
  out.show(true);
  out.appendLine(`$ ${xenoc} build ${projectRoot}`);
  out.appendLine("");

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Building XenoScript project…`,
      cancellable: false,
    },
    () =>
      new Promise<void>((resolve) => {
        const child = cp.spawn(xenoc, ["build", projectRoot], {
          cwd: projectRoot,
          env: process.env,
        });

        child.stdout?.on("data", (buf: Buffer) => {
          out.append(buf.toString());
        });
        child.stderr?.on("data", (buf: Buffer) => {
          out.append(buf.toString());
        });
        child.on("error", (err) => {
          out.appendLine(`\nFailed to start xenoc: ${err.message}`);
          vscode.window.showErrorMessage(
            `XenoScript build failed to start: ${err.message}`,
          );
          resolve();
        });
        child.on("close", (code) => {
          out.appendLine("");
          if (code === 0) {
            out.appendLine("Build succeeded.");
            vscode.window.showInformationMessage(
              "XenoScript: build succeeded.",
            );
          } else {
            out.appendLine(`Build failed (exit ${code}).`);
            vscode.window.showErrorMessage(
              `XenoScript: build failed (exit ${code}). See “XenoScript Build” output.`,
            );
          }
          resolve();
        });
      }),
  );
}

// ── Stub content provider ─────────────────────────────────────────────────────

class XenoStubContentProvider implements vscode.TextDocumentContentProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const key = uri.toString();
    const content = stubContentCache.get(key);
    if (content) {
      return [
        "// ─────────────────────────────────────────────────────────────",
        `// XenoScript stub — ${uri.authority || uri.path.replace(/^\//, "")}`,
        "// This is a generated read-only view. The actual definition lives",
        "// inside a compiled .xar archive.",
        "// ─────────────────────────────────────────────────────────────",
        "",
        content,
      ].join("\n");
    }

    return [
      "// XenoScript stub",
      `// No source available for: ${uri.toString()}`,
      "// Try navigating here via go-to-definition (F12) in a .xeno file.",
    ].join("\n");
  }

  update(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }
}

// ── Path resolution ───────────────────────────────────────────────────────────

function executableName(): string {
  return process.platform === "win32" ? "xenolsp.exe" : "xenolsp";
}

function isExecutableFile(p: string): boolean {
  try {
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function candidatesUnder(root: string): string[] {
  const name = executableName();
  return [
    path.join(root, "tools", name),
    path.join(root, "bin", name),
    path.join(root, name),
    path.join(root, "tools", "bin", name),
  ];
}

function findInAncestors(startDir: string, maxLevels = 8): string | undefined {
  let dir = path.resolve(startDir);
  for (let i = 0; i < maxLevels; i++) {
    for (const candidate of candidatesUnder(dir)) {
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
    const project = path.join(dir, "xeno.project");
    if (fs.existsSync(project)) {
      for (const candidate of candidatesUnder(dir)) {
        if (isExecutableFile(candidate)) {
          return candidate;
        }
      }
      const parent = path.dirname(dir);
      for (const candidate of candidatesUnder(parent)) {
        if (isExecutableFile(candidate)) {
          return candidate;
        }
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function inferXenoRoot(serverPath: string): string | undefined {
  const dir = path.dirname(path.resolve(serverPath));
  const base = path.basename(dir).toLowerCase();
  if (base === "tools" || base === "bin") {
    return path.dirname(dir);
  }
  return dir;
}

function resolveServerPath(
  context: vscode.ExtensionContext,
): string | undefined {
  const cfg = vscode.workspace.getConfiguration("xenoscript");
  const name = executableName();

  const configured =
    (process.platform === "win32"
      ? cfg.get<string>("lspPathWindows")
      : cfg.get<string>("lspPathLinux")) ||
    cfg.get<string>("lspPath") ||
    "";

  if (configured.trim()) {
    const resolved = path.resolve(configured.trim());
    if (isExecutableFile(resolved)) {
      resolvedServerSource = "settings (lspPath)";
      return resolved;
    }
    vscode.window.showWarningMessage(
      `XenoScript: configured lspPath does not exist: ${resolved}`,
    );
  }

  const toolchainRoot = (cfg.get<string>("toolchainRoot") || "").trim();
  if (toolchainRoot) {
    const root = path.resolve(toolchainRoot);
    for (const candidate of candidatesUnder(root)) {
      if (isExecutableFile(candidate)) {
        resolvedServerSource = "settings (toolchainRoot)";
        return candidate;
      }
    }
  }

  const envPath =
    process.env.XENOLSP?.trim() || process.env.XENOLSP_PATH?.trim() || "";
  if (envPath) {
    const resolved = path.resolve(envPath);
    if (isExecutableFile(resolved)) {
      resolvedServerSource = "environment (XENOLSP)";
      return resolved;
    }
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    if (folder.uri.scheme !== "file") continue;
    const found = findInAncestors(folder.uri.fsPath);
    if (found) {
      resolvedServerSource = "workspace auto-detect";
      return found;
    }
  }

  for (const doc of vscode.workspace.textDocuments) {
    if (doc.languageId === "xenoscript" && doc.uri.scheme === "file") {
      const found = findInAncestors(path.dirname(doc.uri.fsPath));
      if (found) {
        resolvedServerSource = "open file auto-detect";
        return found;
      }
    }
  }

  const bundled = path.join(context.extensionPath, "bin", name);
  if (isExecutableFile(bundled)) {
    resolvedServerSource = "extension bundle";
    return bundled;
  }

  const pathDirs = (process.env.PATH ?? "").split(path.delimiter);
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (isExecutableFile(candidate)) {
      resolvedServerSource = "PATH";
      return candidate;
    }
  }

  return undefined;
}
