#!/usr/bin/env node
/**
 * Build the Egern deliverables.
 *
 * Steps:
 *  1. bundle each entry point into a self-contained ESM file;
 *  2. stamp the module templates with the release base, version and commit;
 *  3. write `manifest.json` with the source revision and a SHA-256 per artifact.
 *
 * esbuild is configured exactly as the contract requires: `platform: "neutral"`,
 * `format: "esm"`, `bundle: true`, `splitting: false`. That keeps the output free
 * of Node builtins, `process.env`, `Buffer` and bare `import`/`require`
 * statements — none of which Egern documents.
 *
 * Node is a **build-time** dependency only. Nothing in the runtime path uses it.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const srcDir = join(root, "src");
const distDir = join(root, "dist");
const modulesDir = join(root, "modules");

/**
 * Entries, in dependency order, with their declared timeout.
 *
 * `control` and `automation` are deliberately separate files so that the read
 * bundles cannot contain a cloud write executor.
 */
const ENTRIES = [
  { name: "cdt-widget", source: "entries/widget.ts", kind: "read" },
  { name: "cdt-refresh", source: "entries/refresh.ts", kind: "read" },
  { name: "cdt-diagnostics", source: "entries/diagnostics.ts", kind: "read" },
  { name: "cdt-control", source: "entries/control.ts", kind: "write" },
  { name: "cdt-automation", source: "entries/automation.ts", kind: "write" },
];

/**
 * ECMAScript target.
 *
 * A conservative choice that any modern JavaScriptCore supports. This only
 * affects *syntax* lowering; it cannot supply a host API the runtime lacks, and
 * the real target must be confirmed on a device (see docs/compatibility.md).
 */
const TARGET = "es2020";

/**
 * Build token replaced inside module templates.
 *
 * Distinct from Egern's own `{{{ARG}}}`, which must survive into the published
 * module so users can substitute their own values.
 */
const RELEASE_BASE_TOKEN = "@@RELEASE_BASE@@";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * A deterministic build timestamp.
 *
 * Using the wall clock here made `manifest.json` differ on every build even when
 * the sources were identical, so a committed `dist/` could never match a rebuild
 * and any artifact-hash check was meaningless.
 *
 * Resolution order: SOURCE_DATE_EPOCH (the reproducible-builds convention), then
 * the commit's **author** date, then the clock. The author date is used rather
 * than the committer date because `git commit --amend` preserves the author date
 * but rewrites the committer date; keying on the latter would make the manifest
 * change on every amend and never converge.
 */
function resolveGeneratedAt() {
  const epoch = process.env["SOURCE_DATE_EPOCH"];
  if (epoch !== undefined && /^\d+$/.test(epoch)) {
    return new Date(Number(epoch) * 1000).toISOString();
  }
  try {
    const committed = execFileSync("git", ["log", "-1", "--format=%aI"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    if (committed !== "" && Number.isFinite(Date.parse(committed))) {
      return new Date(committed).toISOString();
    }
  } catch {
    // Not a git checkout; fall through.
  }
  return new Date().toISOString();
}

/**
 * Derive `owner/repo` from the `origin` remote.
 *
 * A fork must publish URLs that point at **itself**, not at the repository it
 * forked. Hardcoding the upstream here produced module files whose `script_url`
 * resolved to the wrong repository. `homepage`/`author` in the module templates
 * still credit the original author, which is intentional and unrelated.
 */
function detectRepoSlug() {
  const explicit = process.env["CDT_REPO_SLUG"];
  if (explicit) return explicit.replace(/^\/+|\/+$/g, "");
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
    if (match !== null) return `${match[1]}/${match[2]}`;
  } catch {
    // No origin remote; fall back to the upstream slug below.
  }
  return "wang4386/CDT-Monitor";
}

/**
 * Choose the ref that `script_url` points at.
 *
 * This must be a ref where `dist/` already exists, which is why the default is
 * the current **branch** rather than the current commit: the files being built
 * right now are committed *by* the commit that would be referenced, and content
 * cannot point at its own not-yet-created hash. A released build should pass an
 * explicit tag via `CDT_RELEASE_REF` so the module and its scripts stay pinned
 * to the same immutable revision.
 */
function detectRef(commit) {
  const explicit = process.env["CDT_RELEASE_REF"];
  if (explicit !== undefined && explicit !== "") return explicit;
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    if (branch !== "" && branch !== "HEAD") return branch;
  } catch {
    // Detached HEAD or no git: fall through to the commit.
  }
  return commit;
}

/** Revision metadata used for the release URL and the manifest. */
function resolveRevision() {
  const pkg = readJson(join(root, "package.json"));
  let head = "unknown";
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    // Not a git checkout (e.g. a source tarball). The manifest records this.
  }
  const repoSlug = detectRepoSlug();
  const ref = detectRef(head);
  const baseUrl =
    process.env["CDT_RELEASE_BASE_URL"] ||
    `https://raw.githubusercontent.com/${repoSlug}/${ref}/egern/dist`;
  // The commit that produced these artifacts, supplied by CI.
  //
  // It cannot be discovered locally: a build cannot name the commit that will
  // contain it, so reading HEAD here made `manifest.json` differ from every
  // rebuild and left the tree permanently dirty. CI knows the commit from its
  // own context and stamps it into a published (not committed) artifact.
  const sourceCommit = process.env["CDT_SOURCE_COMMIT"] || null;
  return {
    version: pkg.version,
    commit: sourceCommit,
    head,
    ref,
    repoSlug,
    baseUrl: baseUrl.replace(/\/+$/, ""),
  };
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function bundleEntries() {
  const results = [];
  for (const entry of ENTRIES) {
    const result = await build({
      entryPoints: [join(srcDir, entry.source)],
      outfile: join(distDir, `${entry.name}.js`),
      bundle: true,
      platform: "neutral",
      format: "esm",
      splitting: false,
      target: TARGET,
      // Unminified by default so a device-side failure can actually be read.
      // Set CDT_MINIFY=1 for a smaller release artifact.
      minify: process.env["CDT_MINIFY"] === "1",
      legalComments: "none",
      charset: "utf8",
      logLevel: "warning",
      metafile: true,
    });
    const code = readFileSync(join(distDir, `${entry.name}.js`), "utf8");
    results.push({
      name: `${entry.name}.js`,
      kind: entry.kind,
      bytes: Buffer.byteLength(code, "utf8"),
      sha256: sha256(code),
      inputs: Object.keys(result.metafile.inputs),
    });
  }
  return results;
}

/** Stamp a module template and return the written file name. */
function buildModule(templateName, revision) {
  const source = readFileSync(join(modulesDir, templateName), "utf8");
  const stamped = source.split(RELEASE_BASE_TOKEN).join(revision.baseUrl);
  writeFileSync(join(distDir, templateName), stamped, "utf8");
  return {
    name: templateName,
    bytes: Buffer.byteLength(stamped, "utf8"),
    sha256: sha256(stamped),
  };
}

async function main() {
  const revision = resolveRevision();

  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  const scripts = await bundleEntries();

  const moduleFiles = readdirSync(modulesDir).filter((name) => name.endsWith(".yaml"));
  const modules = moduleFiles.map((name) => buildModule(name, revision));

  const manifest = {
    name: "cdt-monitor-egern",
    version: revision.version,
    commit: revision.commit,
    ref: revision.ref,
    repoSlug: revision.repoSlug,
    releaseBaseUrl: revision.baseUrl,
    generatedAt: resolveGeneratedAt(),
    esbuildTarget: TARGET,
    minified: process.env["CDT_MINIFY"] === "1",
    scripts,
    modules,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(distDir, "manifest.json"), manifestText, "utf8");

  process.stdout.write(
    `built ${scripts.length} scripts and ${modules.length} modules\n` +
      `  repo ${revision.repoSlug}  ref ${revision.ref}\n` +
      `  base ${revision.baseUrl}\n` +
      scripts.map((s) => `  ${s.name.padEnd(22)} ${String(s.bytes).padStart(7)} B  ${s.sha256.slice(0, 12)}`).join("\n") +
      "\n" +
      modules.map((m) => `  ${m.name.padEnd(22)} ${String(m.bytes).padStart(7)} B  ${m.sha256.slice(0, 12)}`).join("\n") +
      "\n",
  );
}

main().catch((error) => {
  process.stderr.write(`build failed: ${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
