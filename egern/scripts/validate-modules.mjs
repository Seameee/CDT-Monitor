#!/usr/bin/env node
/**
 * Validate the generated Egern module YAML files.
 *
 * Checks the invariants the contract makes load-bearing:
 *  - every `widgets[].script_name` resolves to a `generic` scripting;
 *  - script and widget names are unique, so two modules in one profile cannot
 *    silently collide;
 *  - every `script_url` points at an artifact that was actually generated, and
 *    contains no placeholder domain or unstamped build token;
 *  - `env_schema` uses only documented keys (`name`/`description`/
 *    `default_value`/`options`) and only variable names this plugin implements;
 *  - `env_schema` defaults agree with the code's own defaults, so the UI never
 *    shows a default the runtime does not apply;
 *  - a module does not pin widget view-selection variables in script env, which
 *    would override every widget's own choice.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const distDir = join(root, "dist");

const problems = [];
const notes = [];

function problem(message) {
  problems.push(message);
}

/**
 * Code defaults, mirrored from `src/config/parse.ts` and `src/entries/runtime.ts`.
 *
 * Kept as an explicit table so a change to one side without the other fails the
 * build rather than shipping a misleading placeholder.
 */
const CODE_DEFAULTS = {
  CDT_NAME: "CDT",
  CDT_QUOTA_UNIT: "GB",
  CDT_SITE_TYPE: "china",
  CDT_REGION_ID: "cn-hongkong",
  CDT_TRAFFIC_CLASS: "auto",
  CDT_THRESHOLD_PERCENT: "95",
  CDT_REFRESH_SECONDS: "900",
  CDT_BILLING_ENABLED: "false",
  CDT_LOCAL_NOTIFY: "false",
  CDT_TIMEZONE: "Asia/Shanghai",
  CDT_DEBUG: "false",
  CDT_ALLOW_INSECURE_HTTP: "false",
  CDT_SITE_TYPE_SERVER: "china",
};

/** Every environment variable this plugin understands. */
const KNOWN_ENV_KEYS = new Set([
  "CDT_MODE", "CDT_NAMESPACE", "CDT_ACCOUNT_ID", "CDT_ACCESS_KEY_ID",
  "CDT_ACCESS_KEY_SECRET", "CDT_SECURITY_TOKEN", "CDT_SITE_TYPE", "CDT_REGION_ID",
  "CDT_INSTANCE_ID", "CDT_NAME", "CDT_QUOTA", "CDT_QUOTA_UNIT",
  "CDT_THRESHOLD_PERCENT", "CDT_TRAFFIC_CLASS", "CDT_REFRESH_SECONDS",
  "CDT_BILLING_ENABLED", "CDT_LOCAL_NOTIFY", "CDT_TIMEZONE", "CDT_DEBUG",
  "CDT_BASE_URL", "CDT_READ_TOKEN", "CDT_ALLOW_INSECURE_HTTP", "CDT_ACCOUNTS_JSON",
  "CDT_NOTIFICATION_JSON", "CDT_CONTROL_JSON", "CDT_CONTROL_INTENT_JSON",
  "CDT_TELEGRAM_BOT_TOKEN", "CDT_SCOPE_ID", "CDT_INSTANCE_IDS", "CDT_THEME",
]);

/** Documented `env_schema` descriptor fields. */
const ALLOWED_SCHEMA_FIELDS = new Set(["name", "description", "default_value", "options"]);

/** Widget view-selection variables that must not be pinned in script env. */
const VIEW_VARS = ["CDT_SCOPE_ID", "CDT_INSTANCE_IDS", "CDT_THEME"];

/** Script type keys documented by Egern. */
const SCRIPT_TYPES = ["http_request", "http_response", "schedule", "generic", "network"];

/**
 * Apply Egern's `compat_arguments` substitution.
 *
 * Egern replaces every `{{{NAME}}}` with the module's default (or the value from
 * the module reference) at parse time. Name-collision checks are only meaningful
 * *after* that substitution, because two modules may legitimately share the same
 * template while differing in `MODULE_ID`.
 */
function substitute(text, args) {
  return text.replace(/\{\{\{\s*([A-Za-z0-9_]+)\s*\}\}\}/g, (match, key) =>
    key in args ? String(args[key]) : match,
  );
}

if (!existsSync(distDir)) {
  problem("dist/ 不存在；请先运行 npm run build");
} else {
  const distFiles = new Set(readdirSync(distDir));
  const manifestPath = join(distDir, "manifest.json");

  if (!existsSync(manifestPath)) {
    problem("dist/manifest.json 缺失");
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof manifest.commit !== "string" || manifest.commit === "") {
      problem("manifest.json 缺少 commit");
    }
    if (typeof manifest.releaseBaseUrl !== "string" || manifest.releaseBaseUrl === "") {
      problem("manifest.json 缺少 releaseBaseUrl");
    }
    if (manifest.releaseBaseUrl.includes("example.com")) {
      problem("manifest.json 的 releaseBaseUrl 仍是占位域名");
    }
    for (const artifact of [...(manifest.scripts ?? []), ...(manifest.modules ?? [])]) {
      if (!distFiles.has(artifact.name)) {
        problem(`manifest 声明的产物不存在：${artifact.name}`);
      }
      if (typeof artifact.sha256 !== "string" || artifact.sha256.length !== 64) {
        problem(`产物 ${artifact.name} 缺少有效的 sha256`);
      }
    }
  }

  const moduleFiles = readdirSync(distDir).filter((name) => name.endsWith(".yaml"));
  if (moduleFiles.length === 0) problem("dist/ 中没有任何模块 YAML");

  for (const fileName of moduleFiles) {
    const filePath = join(distDir, fileName);
    let doc;
    try {
      doc = parseYaml(readFileSync(filePath, "utf8"));
    } catch (error) {
      problem(`${fileName}: YAML 解析失败：${error.message}`);
      continue;
    }
    if (doc === null || typeof doc !== "object") {
      problem(`${fileName}: 顶层必须是对象`);
      continue;
    }

    if (typeof doc.name !== "string" || doc.name.trim() === "") {
      problem(`${fileName}: 缺少 name`);
    }
    if (doc.icon !== undefined && typeof doc.icon !== "string") {
      problem(`${fileName}: icon 必须是字符串`);
    }

    // ---- compat_arguments -------------------------------------------------
    const compat = doc.compat_arguments;
    if (compat === undefined) {
      problem(`${fileName}: 缺少 compat_arguments.MODULE_ID`);
    } else if (typeof compat !== "object" || !("MODULE_ID" in compat)) {
      problem(`${fileName}: compat_arguments 必须声明 MODULE_ID`);
    } else if (!/^[A-Za-z0-9_-]+$/.test(String(compat.MODULE_ID))) {
      problem(`${fileName}: MODULE_ID 默认值只允许 [A-Za-z0-9_-]+`);
    }

    // ---- env_schema -------------------------------------------------------
    const schema = doc.env_schema ?? {};
    if (typeof schema !== "object") {
      problem(`${fileName}: env_schema 必须是对象`);
    } else {
      for (const [key, descriptor] of Object.entries(schema)) {
        if (!KNOWN_ENV_KEYS.has(key)) {
          problem(`${fileName}: env_schema 声明了未实现的变量 ${key}`);
        }
        if (descriptor === null || typeof descriptor !== "object") {
          problem(`${fileName}: env_schema.${key} 必须是对象`);
          continue;
        }
        for (const field of Object.keys(descriptor)) {
          if (!ALLOWED_SCHEMA_FIELDS.has(field)) {
            problem(`${fileName}: env_schema.${key} 含未文档化字段 ${field}`);
          }
        }
        const options = descriptor.options;
        if (options !== undefined) {
          if (!Array.isArray(options) || options.length === 0) {
            problem(`${fileName}: env_schema.${key}.options 必须是非空数组`);
          } else if (descriptor.default_value !== undefined && !options.includes(descriptor.default_value)) {
            problem(
              `${fileName}: env_schema.${key} 的 default_value 不在 options 中`,
            );
          }
        }
        // Toggle detection: exactly ["true","false"].
        if (Array.isArray(options)) {
          const isToggle =
            options.length === 2 && options.includes("true") && options.includes("false");
          if (isToggle && descriptor.default_value !== undefined &&
              descriptor.default_value !== "true" && descriptor.default_value !== "false") {
            problem(`${fileName}: env_schema.${key} 是 Toggle，但 default_value 不是 true/false`);
          }
        }
        // Mirror the code default.
        const expected = CODE_DEFAULTS[key];
        if (expected !== undefined && descriptor.default_value !== expected) {
          problem(
            `${fileName}: env_schema.${key} 的 default_value=${String(descriptor.default_value)} 与代码默认值 ${expected} 不一致`,
          );
        }
      }
    }

    // ---- scriptings -------------------------------------------------------
    const scriptings = Array.isArray(doc.scriptings) ? doc.scriptings : [];
    if (scriptings.length === 0) problem(`${fileName}: 缺少 scriptings`);

    const genericNames = new Set();
    const allScriptNames = new Set();

    for (const [index, entry] of scriptings.entries()) {
      if (entry === null || typeof entry !== "object") {
        problem(`${fileName}: scriptings[${index}] 必须是对象`);
        continue;
      }
      const typeKeys = Object.keys(entry).filter((key) => SCRIPT_TYPES.includes(key));
      if (typeKeys.length !== 1) {
        problem(`${fileName}: scriptings[${index}] 必须且只能有一个类型键`);
        continue;
      }
      const type = typeKeys[0];
      const body = entry[type];
      if (body === null || typeof body !== "object") {
        problem(`${fileName}: scriptings[${index}].${type} 必须是对象`);
        continue;
      }
      const name = body.name;
      if (typeof name !== "string" || name.trim() === "") {
        problem(`${fileName}: scriptings[${index}].${type} 缺少 name`);
        continue;
      }
      if (allScriptNames.has(name)) {
        problem(`${fileName}: 脚本名重复：${name}`);
      }
      allScriptNames.add(name);
      if (type === "generic") genericNames.add(name);

      if (type === "schedule") {
        if (typeof body.cron !== "string" || body.cron.trim() === "") {
          problem(`${fileName}: schedule ${name} 缺少 cron`);
        } else {
          const fields = body.cron.trim().split(/\s+/).length;
          if (fields !== 5 && fields !== 6) {
            problem(`${fileName}: schedule ${name} 的 cron 必须是 5 或 6 字段`);
          }
        }
      }

      const scriptUrl = body.script_url;
      if (typeof scriptUrl !== "string" || scriptUrl === "") {
        problem(`${fileName}: ${name} 缺少 script_url`);
      } else {
        if (scriptUrl.includes("@@")) {
          problem(`${fileName}: ${name} 的 script_url 仍含未替换的构建占位符`);
        }
        if (scriptUrl.includes("example.com")) {
          problem(`${fileName}: ${name} 的 script_url 仍指向 example.com`);
        }
        const artifact = scriptUrl.split("/").pop();
        if (artifact && !distFiles.has(artifact)) {
          problem(`${fileName}: ${name} 的 script_url 指向不存在的产物 ${artifact}`);
        }
      }

      if (entry[type].disabled === true) {
        notes.push(`${fileName}: ${name} 默认 disabled（符合预期）`);
      }

      // View variables belong to widget env only.
      if (body.env !== null && typeof body.env === "object") {
        for (const viewVar of VIEW_VARS) {
          if (viewVar in body.env) {
            problem(
              `${fileName}: ${name} 在脚本 env 中设置了视图变量 ${viewVar}；视图选择必须由 widget env 提供`,
            );
          }
        }
      }
    }

    // ---- widgets ----------------------------------------------------------
    const widgets = doc.widgets ?? [];
    if (!Array.isArray(widgets)) {
      problem(`${fileName}: widgets 必须是数组`);
    } else {
      const widgetNames = new Set();
      for (const [index, widget] of widgets.entries()) {
        if (widget === null || typeof widget !== "object") {
          problem(`${fileName}: widgets[${index}] 必须是对象`);
          continue;
        }
        if (typeof widget.name !== "string" || widget.name.trim() === "") {
          problem(`${fileName}: widgets[${index}] 缺少 name`);
          continue;
        }
        if (widgetNames.has(widget.name)) {
          problem(`${fileName}: widget 名重复：${widget.name}`);
        }
        widgetNames.add(widget.name);

        const target = typeof widget.script_name === "string" ? widget.script_name : widget.name;
        if (!genericNames.has(target)) {
          problem(
            `${fileName}: widget ${widget.name} 关联的脚本 ${target} 不存在或不指向 generic 脚本`,
          );
        }
      }
    }

    // ---- content fields that would be dangerous here ----------------------
    for (const forbidden of ["mitm", "http_captures", "dns", "rules", "url_rewrites", "header_rewrites", "body_rewrites"]) {
      if (doc[forbidden] !== undefined) {
        problem(
          `${fileName}: 声明了 ${forbidden}；本项目只发主动 API 请求，不应修改用户 DNS、代理规则或开启 MITM`,
        );
      }
    }
  }
}

// --------------------------------------------------------------------------
// Cross-module uniqueness: two installed modules must not share names.
// --------------------------------------------------------------------------
if (existsSync(distDir)) {
  const seenScript = new Map();
  const seenWidget = new Map();
  for (const fileName of readdirSync(distDir).filter((name) => name.endsWith(".yaml"))) {
    const doc = parseYaml(readFileSync(join(distDir, fileName), "utf8"));
    // Resolve placeholders the way Egern will, so `main` vs `server` modules do
    // not look like a collision.
    const args = doc.compat_arguments ?? {};
    for (const entry of doc.scriptings ?? []) {
      const type = SCRIPT_TYPES.find((key) => key in entry);
      if (!type) continue;
      const rawName = entry[type]?.name;
      if (typeof rawName !== "string") continue;
      const name = substitute(rawName, args);
      if (seenScript.has(name)) {
        problem(`脚本名跨模块重复：${name}（${seenScript.get(name)} 与 ${fileName}）`);
      }
      seenScript.set(name, fileName);
    }
    for (const widget of doc.widgets ?? []) {
      if (typeof widget.name !== "string") continue;
      const name = substitute(widget.name, args);
      if (seenWidget.has(name)) {
        problem(`widget 名跨模块重复：${name}（${seenWidget.get(name)} 与 ${fileName}）`);
      }
      seenWidget.set(name, fileName);
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`check:modules 失败（${problems.length} 项）：\n`);
  for (const item of problems) process.stderr.write(`  ✗ ${item}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("check:modules 通过\n");
  for (const note of notes) process.stdout.write(`  · ${note}\n`);
}
