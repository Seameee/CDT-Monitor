/**
 * Module template invariants.
 *
 * These run against the **source** template in `modules/`, so they hold even
 * before a build. `scripts/validate-modules.mjs` repeats the critical checks
 * against the stamped `dist/` output, where the build tokens have been resolved.
 *
 * Since the plugin ships as a single self-contained module, the most important
 * property to assert here is that installing it cannot, by itself, enable any
 * cloud write: no env default, and no script-level env, may switch control on.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const modulesDir = join(root, "modules");

const SCRIPT_TYPES = ["http_request", "http_response", "schedule", "generic", "network"];

function loadModules(): Array<{ fileName: string; doc: Record<string, unknown> }> {
  return readdirSync(modulesDir)
    .filter((name) => name.endsWith(".yaml"))
    .map((fileName) => ({
      fileName,
      doc: parseYaml(readFileSync(join(modulesDir, fileName), "utf8")) as Record<string, unknown>,
    }));
}

/** The single module's parsed document. */
function theModule(): { fileName: string; doc: Record<string, unknown> } {
  const modules = loadModules();
  assert.equal(modules.length, 1, "the plugin ships as exactly one module");
  return modules[0] as { fileName: string; doc: Record<string, unknown> };
}

/** Read a scripting body by name, tagging which type it was declared as. */
function scriptingByName(
  doc: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  for (const entry of (doc["scriptings"] as Array<Record<string, unknown>>) ?? []) {
    const type = SCRIPT_TYPES.find((key) => key in entry);
    if (type === undefined) continue;
    const body = entry[type] as Record<string, unknown>;
    if (body["name"] === name) return { ...body, __type: type };
  }
  throw new Error(`scripting ${name} not found`);
}

test("the plugin ships as exactly one self-contained module", () => {
  const { fileName, doc } = theModule();
  assert.equal(fileName, "cdt-monitor.yaml");
  assert.equal(typeof doc["name"], "string");
  assert.ok(String(doc["name"]).length > 0);
  assert.equal(typeof doc["icon"], "string");
});

test("the module declares every entry point it needs, each pointing at a real artifact", () => {
  const { doc } = theModule();
  const expected: Array<[string, string]> = [
    ["cdt-{{{MODULE_ID}}}-widget", "cdt-widget.js"],
    ["cdt-{{{MODULE_ID}}}-diagnostics", "cdt-diagnostics.js"],
    ["cdt-{{{MODULE_ID}}}-refresh", "cdt-refresh.js"],
    ["cdt-{{{MODULE_ID}}}-manual", "cdt-control.js"],
    ["cdt-{{{MODULE_ID}}}-automation", "cdt-automation.js"],
  ];
  for (const [name, artifact] of expected) {
    const body = scriptingByName(doc, name);
    const url = String(body["script_url"]);
    assert.ok(url.endsWith(`/${artifact}`), `${name} should point at ${artifact}, got ${url}`);
    // This reads the *source* template, where the release base is still a build
    // token. That the stamped output contains no token is asserted separately by
    // scripts/validate-modules.mjs against dist/.
    assert.ok(
      url.includes("@@RELEASE_BASE@@"),
      `${name} should use the build-time release token, got ${url}`,
    );
    assert.ok(!url.includes("example.com"), `${name} points at a placeholder domain`);
  }
});

test("the two schedules do not share a cadence", () => {
  const { doc } = theModule();
  const refresh = scriptingByName(doc, "cdt-{{{MODULE_ID}}}-refresh");
  const automation = scriptingByName(doc, "cdt-{{{MODULE_ID}}}-automation");
  assert.equal(refresh["__type"], "schedule");
  assert.equal(automation["__type"], "schedule");
  // A 15-minute collection cycle cannot cover the 10-minute compensation window.
  assert.equal(automation["cron"], "*/5 * * * *");
  assert.equal(refresh["cron"], "*/15 * * * *");
});

test("every module name is namespaced by MODULE_ID", () => {
  const { doc } = theModule();
  const compat = doc["compat_arguments"] as Record<string, unknown> | undefined;
  assert.ok(compat !== undefined, "compat_arguments must be declared");
  assert.match(String(compat?.["MODULE_ID"]), /^[A-Za-z0-9_-]+$/);

  for (const entry of (doc["scriptings"] as Array<Record<string, unknown>>) ?? []) {
    const type = SCRIPT_TYPES.find((key) => key in entry);
    const body = entry[type as string] as Record<string, unknown>;
    assert.ok(
      String(body["name"]).includes("{{{MODULE_ID}}}"),
      `${String(body["name"])} lacks the MODULE_ID prefix`,
    );
  }
});

test("the single widget only references the read-only widget script", () => {
  const { doc } = theModule();
  const widgets = (doc["widgets"] as Array<Record<string, unknown>> | undefined) ?? [];
  assert.equal(widgets.length, 1);
  const target = String(widgets[0]?.["script_name"] ?? widgets[0]?.["name"]);
  assert.equal(target, "cdt-{{{MODULE_ID}}}-widget");
  assert.ok(!target.includes("manual"));
  assert.ok(!target.includes("automation"));
});

test("installing the module cannot by itself enable any cloud write", () => {
  const { doc } = theModule();

  for (const entry of (doc["scriptings"] as Array<Record<string, unknown>>) ?? []) {
    const type = SCRIPT_TYPES.find((key) => key in entry);
    const body = entry[type as string] as Record<string, unknown>;
    const env = (body["env"] as Record<string, unknown> | undefined) ?? {};
    for (const key of ["CDT_CONTROL_JSON", "CDT_CONTROL_INTENT_JSON"]) {
      assert.equal(env[key], undefined, `${String(body["name"])} must not preset ${key}`);
    }
  }

  const schema = (doc["env_schema"] as Record<string, Record<string, unknown>>) ?? {};
  for (const key of ["CDT_CONTROL_JSON", "CDT_CONTROL_INTENT_JSON"]) {
    assert.equal(schema[key]?.["default_value"], undefined, `${key} must have no default`);
  }

  // No boolean may default to true: enabling must be an explicit user act.
  for (const [key, descriptor] of Object.entries(schema)) {
    assert.notEqual(descriptor["default_value"], "true", `${key} must not default to true`);
  }
});

test("the module documents what the device attestation means", () => {
  const { doc } = theModule();
  const schema = (doc["env_schema"] as Record<string, Record<string, unknown>>) ?? {};
  const described = JSON.stringify(schema["CDT_CONTROL_JSON"] ?? {});
  // Enabling a cloud write must be an informed act, not a copied snippet.
  assert.ok(described.includes("deviceVerification"));
  assert.ok(described.includes("crossExecutionIntentClaim"));
  assert.ok(described.includes("hostSerializesSameTarget"));
  assert.ok(described.includes("enabled"));
});

test("the data-source picker means one module covers both modes", () => {
  const { doc } = theModule();
  const schema = (doc["env_schema"] as Record<string, Record<string, unknown>>) ?? {};
  const mode = schema["CDT_MODE"];
  assert.ok(mode !== undefined, "CDT_MODE must exist");
  assert.deepEqual(mode?.["options"], ["direct", "server"]);
  assert.equal(mode?.["default_value"], "direct");
  for (const key of ["CDT_ACCESS_KEY_ID", "CDT_BASE_URL", "CDT_READ_TOKEN"]) {
    assert.ok(schema[key] !== undefined, `${key} missing`);
  }
});

test("env_schema uses only documented descriptor fields and known variables", () => {
  const { doc } = theModule();
  const allowed = new Set(["name", "description", "default_value", "options"]);
  const schema = (doc["env_schema"] as Record<string, Record<string, unknown>>) ?? {};
  for (const [key, descriptor] of Object.entries(schema)) {
    assert.match(key, /^CDT_[A-Z0-9_]+$/, `unexpected variable ${key}`);
    for (const field of Object.keys(descriptor)) {
      assert.ok(allowed.has(field), `${key} uses undocumented field ${field}`);
    }
    const options = descriptor["options"];
    if (options === undefined) continue;
    assert.ok(Array.isArray(options) && options.length > 0, `${key}.options`);
    const defaultValue = descriptor["default_value"];
    if (defaultValue !== undefined) {
      assert.ok(
        (options as unknown[]).includes(defaultValue),
        `${key} default is not among its options`,
      );
    }
    const isToggle =
      (options as unknown[]).length === 2 &&
      (options as unknown[]).includes("true") &&
      (options as unknown[]).includes("false");
    if (isToggle) {
      assert.ok(
        defaultValue === "true" || defaultValue === "false",
        `toggle ${key} must have a string "true"/"false" default`,
      );
    }
  }
});

test("secrets are never given a default value in env_schema", () => {
  const { doc } = theModule();
  const schema = (doc["env_schema"] as Record<string, Record<string, unknown>>) ?? {};
  for (const key of [
    "CDT_ACCESS_KEY_SECRET",
    "CDT_READ_TOKEN",
    "CDT_SECURITY_TOKEN",
    "CDT_TELEGRAM_BOT_TOKEN",
  ]) {
    const descriptor = schema[key];
    if (descriptor === undefined) continue;
    assert.equal(descriptor["default_value"], undefined, `${key} must not ship a default`);
  }
});

test("the module performs no MITM, DNS interception or rewrite rules", () => {
  // This plugin only makes outbound API requests; it must never ask the user to
  // intercept their own traffic.
  const { doc } = theModule();
  for (const forbidden of [
    "mitm", "http_captures", "dns", "rules", "url_rewrites",
    "header_rewrites", "body_rewrites", "map_locals",
  ]) {
    assert.equal(doc[forbidden], undefined, `module declares ${forbidden}`);
  }
});

test("view-selection variables are not pinned in script env", () => {
  const { doc } = theModule();
  for (const entry of (doc["scriptings"] as Array<Record<string, unknown>>) ?? []) {
    const type = SCRIPT_TYPES.find((key) => key in entry);
    const body = entry[type as string] as Record<string, unknown>;
    const env = (body["env"] as Record<string, unknown> | undefined) ?? {};
    for (const viewVar of ["CDT_SCOPE_ID", "CDT_INSTANCE_IDS", "CDT_THEME"]) {
      assert.equal(env[viewVar], undefined, `${viewVar} must be set per widget, not per module`);
    }
  }
});

test("the built dist output exists once a build has run", () => {
  const distDir = join(root, "dist");
  if (!existsSync(distDir)) {
    // `npm test` may legitimately run before `npm run build`.
    return;
  }
  const files = readdirSync(distDir);
  for (const expected of [
    "cdt-widget.js", "cdt-refresh.js", "cdt-diagnostics.js",
    "cdt-control.js", "cdt-automation.js", "manifest.json", "cdt-monitor.yaml",
  ]) {
    assert.ok(files.includes(expected), `dist/${expected} is missing`);
  }
  // The merged design means the old two-module split must be gone.
  for (const gone of ["cdt-monitor-server.yaml", "cdt-monitor-control.yaml"]) {
    assert.ok(!files.includes(gone), `dist/${gone} should no longer be published`);
  }
});
