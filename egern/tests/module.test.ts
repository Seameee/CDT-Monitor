/**
 * Module template invariants.
 *
 * These run against the **source** templates in `modules/`, so they hold even
 * before a build. `scripts/validate-modules.mjs` repeats the critical checks
 * against the stamped `dist/` output, where the build tokens have been resolved.
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

test("all three module templates exist and parse", () => {
  const modules = loadModules();
  const names = modules.map((module) => module.fileName).sort();
  assert.deepEqual(names, [
    "cdt-monitor-control.yaml",
    "cdt-monitor-server.yaml",
    "cdt-monitor.yaml",
  ]);
  for (const module of modules) {
    assert.equal(typeof module.doc["name"], "string", module.fileName);
    assert.ok(String(module.doc["name"]).length > 0);
  }
});

test("every module declares a non-secret MODULE_ID used to namespace names", () => {
  const seenIds = new Set<string>();
  for (const { fileName, doc } of loadModules()) {
    const compat = doc["compat_arguments"] as Record<string, unknown> | undefined;
    assert.ok(compat !== undefined, `${fileName} must declare compat_arguments`);
    const moduleId = compat?.["MODULE_ID"];
    assert.equal(typeof moduleId, "string", fileName);
    assert.match(String(moduleId), /^[A-Za-z0-9_-]+$/, fileName);
    // Distinct defaults mean installing two modules cannot collide by accident.
    assert.ok(!seenIds.has(String(moduleId)), `${fileName} reuses MODULE_ID ${String(moduleId)}`);
    seenIds.add(String(moduleId));
  }
});

test("widgets only reference generic scripts and every name uses MODULE_ID", () => {
  for (const { fileName, doc } of loadModules()) {
    const scriptings = (doc["scriptings"] as Array<Record<string, unknown>>) ?? [];
    const genericNames = new Set<string>();
    for (const entry of scriptings) {
      const type = SCRIPT_TYPES.find((key) => key in entry);
      assert.ok(type !== undefined, `${fileName}: a script has no type key`);
      const body = entry[type as string] as Record<string, unknown>;
      const name = String(body["name"]);
      assert.ok(name.includes("{{{MODULE_ID}}}"), `${fileName}: ${name} lacks the MODULE_ID prefix`);
      if (type === "generic") genericNames.add(name);
      // Every script must point at a real artifact, with a resolved base.
      const url = String(body["script_url"]);
      assert.ok(url.includes("@@RELEASE_BASE@@") || url.startsWith("https://"), `${fileName}: ${url}`);
      assert.ok(!url.includes("example.com"), `${fileName}: placeholder domain in ${url}`);
      assert.ok(!url.includes("TODO"), `${fileName}: unresolved TODO in ${url}`);
    }

    const widgets = (doc["widgets"] as Array<Record<string, unknown>> | undefined) ?? [];
    for (const widget of widgets) {
      const target = String(widget["script_name"] ?? widget["name"]);
      assert.ok(genericNames.has(target), `${fileName}: widget -> ${target} is not a generic script`);
    }
  }
});

test("no module enables MITM, DNS interception or rewrite rules", () => {
  // This plugin only makes outbound API requests; it must never ask the user to
  // intercept their own traffic.
  for (const { fileName, doc } of loadModules()) {
    for (const forbidden of [
      "mitm", "http_captures", "dns", "rules", "url_rewrites",
      "header_rewrites", "body_rewrites", "map_locals",
    ]) {
      assert.equal(doc[forbidden], undefined, `${fileName} declares ${forbidden}`);
    }
  }
});

test("env_schema uses only documented descriptor fields and known variables", () => {
  const allowed = new Set(["name", "description", "default_value", "options"]);
  for (const { fileName, doc } of loadModules()) {
    const schema = (doc["env_schema"] as Record<string, Record<string, unknown>>) ?? {};
    for (const [key, descriptor] of Object.entries(schema)) {
      assert.match(key, /^CDT_[A-Z0-9_]+$/, `${fileName}: unexpected variable ${key}`);
      for (const field of Object.keys(descriptor)) {
        assert.ok(allowed.has(field), `${fileName}: ${key} uses undocumented field ${field}`);
      }
      const options = descriptor["options"];
      if (options !== undefined) {
        assert.ok(Array.isArray(options) && options.length > 0, `${fileName}: ${key}.options`);
        const defaultValue = descriptor["default_value"];
        if (defaultValue !== undefined) {
          assert.ok(
            (options as unknown[]).includes(defaultValue),
            `${fileName}: ${key} default is not among its options`,
          );
        }
      }
    }
  }
});

test("boolean toggles are declared as exactly [true,false] with a string default", () => {
  for (const { fileName, doc } of loadModules()) {
    const schema = (doc["env_schema"] as Record<string, Record<string, unknown>>) ?? {};
    for (const [key, descriptor] of Object.entries(schema)) {
      const options = descriptor["options"] as unknown[] | undefined;
      if (options === undefined) continue;
      const isToggle =
        options.length === 2 && options.includes("true") && options.includes("false");
      if (!isToggle) continue;
      const defaultValue = descriptor["default_value"];
      assert.ok(
        defaultValue === "true" || defaultValue === "false",
        `${fileName}: toggle ${key} must have a string "true"/"false" default`,
      );
    }
  }
});

test("secrets are never given a default value in env_schema", () => {
  for (const { fileName, doc } of loadModules()) {
    const schema = (doc["env_schema"] as Record<string, Record<string, unknown>>) ?? {};
    for (const key of ["CDT_ACCESS_KEY_SECRET", "CDT_READ_TOKEN", "CDT_SECURITY_TOKEN"]) {
      const descriptor = schema[key];
      if (descriptor === undefined) continue;
      assert.equal(
        descriptor["default_value"],
        undefined,
        `${fileName}: ${key} must not ship a default value`,
      );
    }
  }
});

test("the control module ships every write script disabled", () => {
  const control = loadModules().find((module) => module.fileName === "cdt-monitor-control.yaml");
  assert.ok(control !== undefined);
  const scriptings = (control?.doc["scriptings"] as Array<Record<string, unknown>>) ?? [];
  assert.ok(scriptings.length > 0);
  for (const entry of scriptings) {
    const type = SCRIPT_TYPES.find((key) => key in entry);
    const body = entry[type as string] as Record<string, unknown>;
    assert.equal(body["disabled"], true, `${String(body["name"])} must ship disabled`);
  }
  // A control script must not be attachable to a widget.
  assert.equal(control?.doc["widgets"], undefined);
});

test("the automation cron runs more often than the collection cron", () => {
  const control = loadModules().find((module) => module.fileName === "cdt-monitor-control.yaml");
  const base = loadModules().find((module) => module.fileName === "cdt-monitor.yaml");
  const cronOf = (doc: Record<string, unknown> | undefined): string => {
    const scriptings = (doc?.["scriptings"] as Array<Record<string, unknown>>) ?? [];
    for (const entry of scriptings) {
      if (!("schedule" in entry)) continue;
      return String((entry["schedule"] as Record<string, unknown>)["cron"]);
    }
    return "";
  };
  // The 10-minute compensation window cannot be covered by a 15-minute cycle.
  assert.equal(cronOf(control?.doc), "*/5 * * * *");
  assert.equal(cronOf(base?.doc), "*/15 * * * *");
});

test("view-selection variables are not pinned in any module script env", () => {
  for (const { fileName, doc } of loadModules()) {
    const scriptings = (doc["scriptings"] as Array<Record<string, unknown>>) ?? [];
    for (const entry of scriptings) {
      const type = SCRIPT_TYPES.find((key) => key in entry);
      const body = entry[type as string] as Record<string, unknown>;
      const env = (body["env"] as Record<string, unknown> | undefined) ?? {};
      for (const viewVar of ["CDT_SCOPE_ID", "CDT_INSTANCE_IDS", "CDT_THEME"]) {
        assert.equal(
          env[viewVar],
          undefined,
          `${fileName}: ${viewVar} must be set per widget, not per module`,
        );
      }
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
    "cdt-control.js", "cdt-automation.js", "manifest.json",
    "cdt-monitor.yaml", "cdt-monitor-server.yaml", "cdt-monitor-control.yaml",
  ]) {
    assert.ok(files.includes(expected), `dist/${expected} is missing`);
  }
});
