#!/usr/bin/env node
/**
 * Verify the generated bundles against the platform contract.
 *
 * What is asserted, and why:
 *
 *  1. **Self-containment.** No `import`/`require`, no `node:` specifier, no
 *     `process.env`, no `Buffer`. Egern documents none of these, so a bundle
 *     that needs them would fail on device rather than at build time.
 *  2. **No unverified host globals.** `fetch` and `crypto.subtle` are not
 *     documented; the plugin implements its own encoding and HMAC instead.
 *  3. **No other proxy client's API.** `$httpClient`, `$done`, `$task`,
 *     `$persistentStore`, `$widget`, `ListWidget` belong to Surge/Loon/QX/
 *     Scriptable and are not Egern APIs. Substring checks target usage forms
 *     rather than bare words, because `cdt-diagnostics.js` legitimately prints
 *     these names as probe labels.
 *  4. **Read/write split.** `cdt-widget.js`, `cdt-refresh.js` and
 *     `cdt-diagnostics.js` must not contain `StartInstance`/`StopInstance` or
 *     any reference to the control executor. This is the mechanical proof that
 *     rendering can never change cloud state.
 *  5. **A default export exists**, because generic/schedule entries are loaded
 *     through `export default async function(ctx)`.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const distDir = join(root, "dist");

const problems = [];
const stats = [];

/** Bundles that must remain incapable of writing to the cloud. */
const READ_BUNDLES = new Set(["cdt-widget.js", "cdt-refresh.js", "cdt-diagnostics.js"]);

/** Usage patterns that must never appear in any bundle. */
const FORBIDDEN_PATTERNS = [
  { pattern: /\brequire\s*\(/, why: "使用了 require" },
  { pattern: /(^|[^\w$])import\s*\(/, why: "使用了动态 import" },
  { pattern: /^\s*import\s+[^;]*from\s*["']/m, why: "存在外部 import 语句" },
  { pattern: /from\s*["']node:/, why: "引用了 Node 内建模块" },
  { pattern: /process\.env/, why: "使用了 process.env" },
  { pattern: /\bBuffer\./, why: "使用了 Buffer" },
  { pattern: /\bcrypto\.subtle\b/, why: "使用了未证实的 crypto.subtle" },
  { pattern: /(^|[^\w$.])fetch\s*\(/, why: "使用了未证实的全局 fetch" },
  { pattern: /\$httpClient\b/, why: "混用了 Surge 的 $httpClient" },
  { pattern: /\$persistentStore\b/, why: "混用了 Surge 的 $persistentStore" },
  { pattern: /\$task\b/, why: "混用了 Quantumult X 的 $task" },
  { pattern: /\$done\s*\(/, why: "混用了 $done" },
  { pattern: /\bListWidget\b/, why: "混用了 Scriptable 的 ListWidget" },
  { pattern: /\$widget\b/, why: "混用了 Scriptable 的 $widget" },
  { pattern: /\brequireNative\b/, why: "混用了非 Egern 原生桥接" },
];

/** Action names that only the write path may reference. */
const WRITE_MARKERS = ["StartInstance", "StopInstance", "DirectControlProvider"];

if (!existsSync(distDir)) {
  process.stderr.write("check:bundles 失败：dist/ 不存在；请先运行 npm run build\n");
  process.exitCode = 1;
} else {
  const jsFiles = readdirSync(distDir).filter((name) => name.endsWith(".js"));
  if (jsFiles.length === 0) problems.push("dist/ 中没有任何 bundle");

  for (const fileName of jsFiles) {
    const code = readFileSync(join(distDir, fileName), "utf8");

    // --- default export ---------------------------------------------------
    if (!/export\s*\{[^}]*\bdefault\b[^}]*\}/.test(code) && !/export\s+default\b/.test(code)) {
      problems.push(`${fileName}: 缺少 default export`);
    }

    // --- forbidden constructs --------------------------------------------
    for (const { pattern, why } of FORBIDDEN_PATTERNS) {
      if (pattern.test(code)) {
        problems.push(`${fileName}: ${why}`);
      }
    }

    // --- read/write boundary ---------------------------------------------
    if (READ_BUNDLES.has(fileName)) {
      for (const marker of WRITE_MARKERS) {
        if (code.includes(marker)) {
          problems.push(
            `${fileName}: 只读入口不应包含写执行器标记 ${marker}（读写边界被破坏）`,
          );
        }
      }
    }

    const bytes = Buffer.byteLength(code, "utf8");
    stats.push({ fileName, bytes });
    // A project budget, not a platform limit.
    if (bytes > 200 * 1024) {
      problems.push(`${fileName}: 体积 ${bytes} B 超过 200KB 项目预算`);
    }
  }

  // Sanity check: the write bundle SHOULD contain the action names, otherwise
  // the boundary check above would be vacuous.
  if (jsFiles.includes("cdt-control.js")) {
    const controlCode = readFileSync(join(distDir, "cdt-control.js"), "utf8");
    if (!WRITE_MARKERS.some((marker) => controlCode.includes(marker))) {
      problems.push(
        "cdt-control.js 未包含任何写执行器标记；读写边界检查将失去意义，请检查构建配置",
      );
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`check:bundles 失败（${problems.length} 项）：\n`);
  for (const item of problems) process.stderr.write(`  ✗ ${item}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("check:bundles 通过\n");
  for (const entry of stats) {
    process.stdout.write(`  · ${entry.fileName.padEnd(22)} ${String(entry.bytes).padStart(7)} B\n`);
  }
}
