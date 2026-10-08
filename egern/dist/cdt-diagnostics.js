var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/domain/usage.ts
function trafficClassOfRegion(regionId) {
  if (regionId.startsWith("cn-") && regionId !== "cn-hongkong") {
    return "mainland";
  }
  return "overseas";
}

// src/domain/models.ts
function unverifiedDevice() {
  return {
    crossExecutionIntentClaim: false,
    hostSerializesSameTarget: false,
    verifiedAt: null,
    note: null
  };
}

// src/domain/schedule.ts
var MINUTES_PER_DAY = 24 * 60;
function normalizeClockTime(value) {
  const parsed = parseClockTime(value);
  if (parsed === null) return null;
  return `${parsed.hour < 10 ? "0" : ""}${parsed.hour}:${parsed.minute < 10 ? "0" : ""}${parsed.minute}`;
}
function parseClockTime(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/：/g, ":");
  if (normalized === "24:00") {
    return { hour: 0, minute: 0, minutes: 0 };
  }
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(normalized);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return { hour, minute, minutes: hour * 60 + minute };
}

// src/host/crypto.ts
var SHA1_BLOCK_BYTES = 64;
var SHA1_DIGEST_BYTES = 20;
function rotateLeft32(value, count) {
  return (value << count | value >>> 32 - count) >>> 0;
}
function utf8Bytes(input) {
  const out = [];
  for (let i = 0; i < input.length; i++) {
    let codePoint = input.charCodeAt(i);
    if (codePoint >= 55296 && codePoint <= 56319) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 56320 && next <= 57343) {
        codePoint = (codePoint - 55296 << 10) + (next - 56320) + 65536;
        i++;
      } else {
        codePoint = 65533;
      }
    } else if (codePoint >= 56320 && codePoint <= 57343) {
      codePoint = 65533;
    }
    if (codePoint < 128) {
      out.push(codePoint);
    } else if (codePoint < 2048) {
      out.push(192 | codePoint >> 6, 128 | codePoint & 63);
    } else if (codePoint < 65536) {
      out.push(
        224 | codePoint >> 12,
        128 | codePoint >> 6 & 63,
        128 | codePoint & 63
      );
    } else {
      out.push(
        240 | codePoint >> 18,
        128 | codePoint >> 12 & 63,
        128 | codePoint >> 6 & 63,
        128 | codePoint & 63
      );
    }
  }
  return out;
}
var BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var BASE64_LOOKUP = (() => {
  const table = {};
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    table[BASE64_ALPHABET[i]] = i;
  }
  return table;
})();
function hexEncode(bytes) {
  let out = "";
  for (const byte of bytes) {
    out += (byte < 16 ? "0" : "") + byte.toString(16);
  }
  return out;
}
function sha1(message) {
  const messageLength = message.length;
  const paddedLength = (() => {
    const afterOne = messageLength + 1;
    const remainder = afterOne % SHA1_BLOCK_BYTES;
    const zeroPad = remainder <= 56 ? 56 - remainder : 56 + (SHA1_BLOCK_BYTES - remainder);
    return afterOne + zeroPad + 8;
  })();
  const buffer = new Uint8Array(paddedLength);
  buffer.set(message, 0);
  buffer[messageLength] = 128;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const bitLengthHigh = Math.floor(messageLength / 536870912);
  const bitLengthLow = messageLength % 536870912 * 8;
  view.setUint32(paddedLength - 8, bitLengthHigh, false);
  view.setUint32(paddedLength - 4, bitLengthLow >>> 0, false);
  const h0Init = 1732584193;
  const h1Init = 4023233417;
  const h2Init = 2562383102;
  const h3Init = 271733878;
  const h4Init = 3285377520;
  let h0 = h0Init;
  let h1 = h1Init;
  let h2 = h2Init;
  let h3 = h3Init;
  let h4 = h4Init;
  const words = new Uint32Array(80);
  for (let offset = 0; offset < paddedLength; offset += SHA1_BLOCK_BYTES) {
    for (let i = 0; i < 16; i++) {
      words[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      words[i] = rotateLeft32(
        words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16],
        1
      );
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) {
        f = b & c | ~b & d;
        k = 1518500249;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 1859775393;
      } else if (i < 60) {
        f = b & c | b & d | c & d;
        k = 2400959708;
      } else {
        f = b ^ c ^ d;
        k = 3395469782;
      }
      const temp = rotateLeft32(a, 5) + f + e + k + words[i] >>> 0;
      e = d;
      d = c;
      c = rotateLeft32(b, 30);
      b = a;
      a = temp;
    }
    h0 = h0 + a >>> 0;
    h1 = h1 + b >>> 0;
    h2 = h2 + c >>> 0;
    h3 = h3 + d >>> 0;
    h4 = h4 + e >>> 0;
  }
  const digest = new Uint8Array(SHA1_DIGEST_BYTES);
  const digestView = new DataView(
    digest.buffer,
    digest.byteOffset,
    digest.byteLength
  );
  digestView.setUint32(0, h0, false);
  digestView.setUint32(4, h1, false);
  digestView.setUint32(8, h2, false);
  digestView.setUint32(12, h3, false);
  digestView.setUint32(16, h4, false);
  return Array.from(digest);
}
var UNRESERVED = (() => {
  const table = new Uint8Array(128);
  const marks = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~";
  for (const ch of marks) {
    table[ch.charCodeAt(0)] = 1;
  }
  return table;
})();

// src/providers/cdt-server.ts
function normalizeServerBaseUrl(raw, allowInsecureHttp) {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "") return { ok: false, reason: "未填写服务器地址" };
  const match = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/.exec(trimmed);
  if (match === null) {
    return { ok: false, reason: "服务器地址格式无效" };
  }
  const scheme = match[1].toLowerCase();
  const authority = match[2];
  const path = match[3] ?? "";
  if (scheme === "http" && !allowInsecureHttp) {
    return {
      ok: false,
      reason: "服务器地址必须使用 HTTPS；本机调试需显式开启开发选项"
    };
  }
  if (authority.includes("@")) {
    return { ok: false, reason: "服务器地址不能包含用户名或密码" };
  }
  if (authority === "" || authority.startsWith(":")) {
    return { ok: false, reason: "服务器地址缺少主机名" };
  }
  return { ok: true, baseUrl: `${scheme}://${authority}${path}` };
}

// src/config/env.ts
var IssueCollector = class {
  constructor() {
    __publicField(this, "issues", []);
  }
  add(severity, field, message, entityId = null) {
    this.issues.push({ entityId, field, message, severity });
  }
  error(field, message, entityId = null) {
    this.add("error", field, message, entityId);
  }
  warn(field, message, entityId = null) {
    this.add("warning", field, message, entityId);
  }
  /** Issues that should block the whole configuration. */
  globalErrors() {
    return this.issues.filter((issue) => issue.severity === "error" && issue.entityId === null);
  }
  /** Whether any error (global or scoped) was recorded. */
  hasErrors() {
    return this.issues.some((issue) => issue.severity === "error");
  }
};
function readString(env, key) {
  const raw = env[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}
function readBoolean(env, key, fallback, issues) {
  const raw = env[key];
  if (raw === void 0 || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  issues.warn(key, `${key} 只接受 true/false，已按默认值 ${String(fallback)} 处理`);
  return fallback;
}
function readNumber(env, key, fallback, issues) {
  const raw = env[key];
  if (raw === void 0 || raw.trim() === "") return fallback;
  const trimmed = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    issues.warn(key, `${key} 不是合法数字，已按默认值 ${fallback} 处理`);
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    issues.warn(key, `${key} 不是有限数字，已按默认值 ${fallback} 处理`);
    return fallback;
  }
  return parsed;
}
function readNonNegativeInteger(env, key, fallback, issues) {
  const value = readNumber(env, key, fallback, issues);
  if (!Number.isInteger(value) || value < 0) {
    issues.warn(key, `${key} 必须是非负整数，已按默认值 ${fallback} 处理`);
    return fallback;
  }
  return value;
}
function readEnum(env, key, allowed, fallback, issues) {
  const raw = env[key];
  if (raw === void 0 || raw.trim() === "") return fallback;
  const normalized = raw.trim();
  if (allowed.includes(normalized)) return normalized;
  issues.warn(
    key,
    `${key} 只能是 ${allowed.join(" / ")}，已按默认值 ${fallback} 处理`
  );
  return fallback;
}
function readJson(env, key, issues) {
  const raw = env[key];
  if (raw === void 0 || raw.trim() === "") return void 0;
  try {
    return JSON.parse(raw);
  } catch {
    issues.error(key, `${key} 不是合法的 JSON`);
    return null;
  }
}
function readList(env, key) {
  const raw = readString(env, key);
  if (raw === null) return null;
  const parts = raw.split(",").map((part) => part.trim()).filter((part) => part !== "");
  return parts.length === 0 ? null : parts;
}

// src/domain/timezone.ts
var ASIA_SHANGHAI_OFFSET_MINUTES = 8 * 60;
function pad2(value) {
  return value < 10 ? `0${value}` : String(value);
}
function buildParts(year, month, day, hour, minute, second) {
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    minuteOfDay: hour * 60 + minute,
    date: `${year}-${pad2(month)}-${pad2(day)}`
  };
}
function createIntlFormatter(timeZone) {
  if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") {
    return null;
  }
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    formatter.formatToParts(/* @__PURE__ */ new Date(0));
    return formatter;
  } catch {
    return null;
  }
}
var IntlTimeZoneProvider = class {
  constructor(timeZone, formatter) {
    __publicField(this, "support", "intl");
    __publicField(this, "timeZone");
    __publicField(this, "formatter");
    this.timeZone = timeZone;
    this.formatter = formatter;
  }
  isReliable() {
    return true;
  }
  limitation() {
    return null;
  }
  partsAt(instant) {
    const collected = {};
    for (const part of this.formatter.formatToParts(instant)) {
      if (part.type !== "literal") collected[part.type] = part.value;
    }
    let hour = Number(collected.hour);
    if (hour === 24) hour = 0;
    return buildParts(
      Number(collected.year),
      Number(collected.month),
      Number(collected.day),
      hour,
      Number(collected.minute),
      Number(collected.second)
    );
  }
  offsetMinutesAt(instant) {
    const parts = this.partsAt(instant);
    const asIfUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const instantSeconds = Math.floor(instant.getTime() / 1e3) * 1e3;
    return Math.round((asIfUtc - instantSeconds) / 6e4);
  }
};
var FixedOffsetTimeZoneProvider = class {
  constructor(timeZone, offsetMinutes) {
    __publicField(this, "support", "fixed-offset");
    __publicField(this, "timeZone");
    __publicField(this, "offsetMinutes");
    this.timeZone = timeZone;
    this.offsetMinutes = offsetMinutes;
  }
  isReliable() {
    return true;
  }
  limitation() {
    return "未检测到 Intl 时区支持，已按固定的 UTC+08:00 处理 Asia/Shanghai（该时区自 1991 年起无夏令时，因此结果仍然准确）";
  }
  partsAt(instant) {
    const shifted = new Date(instant.getTime() + this.offsetMinutes * 6e4);
    return buildParts(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth() + 1,
      shifted.getUTCDate(),
      shifted.getUTCHours(),
      shifted.getUTCMinutes(),
      shifted.getUTCSeconds()
    );
  }
  offsetMinutesAt() {
    return this.offsetMinutes;
  }
};
var UnsupportedTimeZoneProvider = class {
  constructor(timeZone, reason) {
    __publicField(this, "support", "unsupported");
    __publicField(this, "timeZone");
    __publicField(this, "reason");
    this.timeZone = timeZone;
    this.reason = reason;
  }
  isReliable() {
    return false;
  }
  limitation() {
    return this.reason;
  }
  partsAt() {
    throw new Error(`timezone ${this.timeZone} is not supported on this host`);
  }
  offsetMinutesAt() {
    throw new Error(`timezone ${this.timeZone} is not supported on this host`);
  }
};
function createTimeZoneProvider(timeZone) {
  const formatter = createIntlFormatter(timeZone);
  if (formatter !== null) {
    return new IntlTimeZoneProvider(timeZone, formatter);
  }
  if (timeZone === "Asia/Shanghai" || timeZone === "UTC+8" || timeZone === "+08:00") {
    return new FixedOffsetTimeZoneProvider(timeZone, ASIA_SHANGHAI_OFFSET_MINUTES);
  }
  return new UnsupportedTimeZoneProvider(
    timeZone,
    `当前运行环境缺少可用的时区数据，无法正确处理 ${timeZone}；本地定时与日报已停用`
  );
}

// src/config/validate.ts
var ADVANCED_SCHEMA_VERSION = 1;
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readRequiredString(record, key, where, issues) {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    issues.error(key, `${where} 缺少必填字符串字段 ${key}`);
    return null;
  }
  return value.trim();
}
function readOptionalString(record, key) {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim();
}
function readOptionalBoolean(record, key, fallback, where, issues) {
  const value = record[key];
  if (value === void 0) return fallback;
  if (typeof value !== "boolean") {
    issues.error(key, `${where} 的 ${key} 必须是布尔值`);
    return fallback;
  }
  return value;
}
function reportUnknownKeys(record, known, where, issues) {
  for (const key of Object.keys(record)) {
    if (!known.includes(key)) {
      issues.warn(key, `${where} 含有未知字段 ${key}，已忽略`);
    }
  }
}
function readQuota(value, where, issues) {
  if (value === void 0 || value === null) return null;
  if (!isRecord(value)) {
    issues.error("quota", `${where} 的 quota 必须是对象`);
    return null;
  }
  reportUnknownKeys(value, ["value", "unit", "source"], `${where}.quota`, issues);
  const amount = value["value"];
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    issues.error("quota.value", `${where} 的 quota.value 必须是正数`);
    return null;
  }
  const unit = value["unit"];
  if (unit !== "GB" && unit !== "GiB") {
    issues.error("quota.unit", `${where} 的 quota.unit 必须是 GB 或 GiB`);
    return null;
  }
  const source = value["source"];
  if (source !== void 0 && source !== "user" && source !== "legacy") {
    issues.error("quota.source", `${where} 的 quota.source 必须是 user 或 legacy`);
    return null;
  }
  return {
    value: amount,
    unit,
    source: source === "legacy" ? "legacy" : "user"
  };
}
function readThreshold(value, where, issues) {
  if (value === void 0) return 95;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100) {
    issues.error("thresholdPercent", `${where} 的 thresholdPercent 必须落在 (0, 100]`);
    return 95;
  }
  return value;
}
function readSchedule(value, where, issues) {
  const fallback = { enabled: false, start: "08:00", stop: "23:30" };
  if (value === void 0) return fallback;
  if (!isRecord(value)) {
    issues.error("schedule", `${where} 的 schedule 必须是对象`);
    return fallback;
  }
  reportUnknownKeys(value, ["enabled", "start", "stop"], `${where}.schedule`, issues);
  const enabled = readOptionalBoolean(value, "enabled", false, `${where}.schedule`, issues);
  const start = normalizeClockTime(typeof value["start"] === "string" ? value["start"] : "");
  const stop = normalizeClockTime(typeof value["stop"] === "string" ? value["stop"] : "");
  if (start === null) {
    issues.error("schedule.start", `${where} 的 schedule.start 不是合法 HH:mm`);
    return fallback;
  }
  if (stop === null) {
    issues.error("schedule.stop", `${where} 的 schedule.stop 不是合法 HH:mm`);
    return fallback;
  }
  if (enabled && start === stop) {
    issues.error(
      "schedule",
      `${where} 的 schedule.start 与 schedule.stop 相同；如需全天窗口请等待显式的全天配置项`
    );
    return { enabled: false, start, stop };
  }
  return { enabled, start, stop };
}
function parseAdvancedModel(value, issues) {
  if (!isRecord(value)) {
    issues.error("CDT_ACCOUNTS_JSON", "CDT_ACCOUNTS_JSON 必须是 JSON 对象");
    return null;
  }
  if (value["schemaVersion"] !== ADVANCED_SCHEMA_VERSION) {
    issues.error(
      "schemaVersion",
      `不支持的 schemaVersion（需要 ${ADVANCED_SCHEMA_VERSION}）；不会回退到其他账号配置`
    );
    return null;
  }
  reportUnknownKeys(
    value,
    ["schemaVersion", "namespace", "credentials", "accounts", "trafficScopes", "instances"],
    "CDT_ACCOUNTS_JSON",
    issues
  );
  const credentials = [];
  const credentialIds = /* @__PURE__ */ new Set();
  const rawCredentials = value["credentials"];
  if (!Array.isArray(rawCredentials) || rawCredentials.length === 0) {
    issues.error("credentials", "credentials 必须是非空数组");
    return null;
  }
  for (const entry of rawCredentials) {
    if (!isRecord(entry)) {
      issues.error("credentials", "credentials 中存在非对象条目");
      continue;
    }
    const where = "credentials[]";
    reportUnknownKeys(
      entry,
      ["id", "accountId", "accessKeyId", "accessKeySecret", "securityToken", "siteType"],
      where,
      issues
    );
    const id = readRequiredString(entry, "id", where, issues);
    const accountId = readRequiredString(entry, "accountId", where, issues);
    const accessKeyId = readRequiredString(entry, "accessKeyId", where, issues);
    const accessKeySecret = readRequiredString(entry, "accessKeySecret", where, issues);
    if (id === null || accountId === null || accessKeyId === null || accessKeySecret === null) {
      continue;
    }
    if (credentialIds.has(id)) {
      issues.error("credentials.id", `凭据 id 重复：${id}`);
      continue;
    }
    credentialIds.add(id);
    const siteType = entry["siteType"];
    if (siteType !== "china" && siteType !== "international") {
      issues.error("siteType", `凭据 ${id} 的 siteType 必须是 china 或 international`);
      continue;
    }
    credentials.push({
      id,
      accountId,
      accessKeyId,
      accessKeySecret,
      siteType,
      ...readOptionalString(entry, "securityToken") !== null ? { securityToken: readOptionalString(entry, "securityToken") } : {}
    });
  }
  const accounts = [];
  const accountIds = /* @__PURE__ */ new Set();
  const rawAccounts = value["accounts"];
  if (!Array.isArray(rawAccounts) || rawAccounts.length === 0) {
    issues.error("accounts", "accounts 必须是非空数组");
    return null;
  }
  for (const entry of rawAccounts) {
    if (!isRecord(entry)) {
      issues.error("accounts", "accounts 中存在非对象条目");
      continue;
    }
    const where = "accounts[]";
    reportUnknownKeys(entry, ["id", "name", "aliyunUid"], where, issues);
    const id = readRequiredString(entry, "id", where, issues);
    if (id === null) continue;
    if (accountIds.has(id)) {
      issues.error("accounts.id", `账户 id 重复：${id}`);
      continue;
    }
    accountIds.add(id);
    accounts.push({
      id,
      name: readOptionalString(entry, "name") ?? id,
      aliyunUid: readOptionalString(entry, "aliyunUid")
    });
  }
  for (const credential of credentials) {
    if (!accountIds.has(credential.accountId)) {
      issues.error(
        "credentials.accountId",
        `凭据 ${credential.id} 引用了不存在的账户 ${credential.accountId}`,
        credential.id
      );
    }
  }
  const trafficScopes = [];
  const scopeIds = /* @__PURE__ */ new Set();
  const rawScopes = value["trafficScopes"];
  if (!Array.isArray(rawScopes)) {
    issues.error("trafficScopes", "trafficScopes 必须是数组");
    return null;
  }
  for (const entry of rawScopes) {
    if (!isRecord(entry)) {
      issues.error("trafficScopes", "trafficScopes 中存在非对象条目");
      continue;
    }
    const where = "trafficScopes[]";
    reportUnknownKeys(
      entry,
      ["id", "accountId", "credentialId", "trafficClass", "quota", "thresholdPercent", "controlTargets"],
      where,
      issues
    );
    const id = readRequiredString(entry, "id", where, issues);
    const accountId = readRequiredString(entry, "accountId", where, issues);
    const credentialId = readRequiredString(entry, "credentialId", where, issues);
    if (id === null || accountId === null || credentialId === null) continue;
    if (scopeIds.has(id)) {
      issues.error("trafficScopes.id", `流量范围 id 重复：${id}`);
      continue;
    }
    scopeIds.add(id);
    const trafficClass = entry["trafficClass"];
    if (trafficClass !== "mainland" && trafficClass !== "overseas") {
      issues.error("trafficClass", `流量范围 ${id} 的 trafficClass 必须是 mainland 或 overseas`);
      continue;
    }
    if (!accountIds.has(accountId)) {
      issues.error("trafficScopes.accountId", `流量范围 ${id} 引用了不存在的账户 ${accountId}`, id);
    }
    if (!credentialIds.has(credentialId)) {
      issues.error("trafficScopes.credentialId", `流量范围 ${id} 引用了不存在的凭据 ${credentialId}`, id);
    }
    const controlTargets = [];
    if (entry["controlTargets"] !== void 0) {
      if (!Array.isArray(entry["controlTargets"])) {
        issues.error("controlTargets", `流量范围 ${id} 的 controlTargets 必须是数组`, id);
      } else {
        for (const target of entry["controlTargets"]) {
          if (typeof target !== "string" || target.trim() === "") {
            issues.error("controlTargets", `流量范围 ${id} 的 controlTargets 含非法条目`, id);
            continue;
          }
          controlTargets.push(target.trim());
        }
      }
    }
    trafficScopes.push({
      id,
      accountId,
      credentialId,
      trafficClass,
      quota: readQuota(entry["quota"], `流量范围 ${id}`, issues),
      thresholdPercent: readThreshold(entry["thresholdPercent"], `流量范围 ${id}`, issues),
      controlTargets
    });
  }
  if (trafficScopes.length === 0) {
    issues.error("trafficScopes", "trafficScopes 不能为空");
    return null;
  }
  const instances = [];
  const instanceIds = /* @__PURE__ */ new Set();
  const rawInstances = value["instances"];
  if (rawInstances !== void 0 && !Array.isArray(rawInstances)) {
    issues.error("instances", "instances 必须是数组");
    return null;
  }
  for (const entry of rawInstances ?? []) {
    if (!isRecord(entry)) {
      issues.error("instances", "instances 中存在非对象条目");
      continue;
    }
    const where = "instances[]";
    reportUnknownKeys(
      entry,
      [
        "id",
        "accountId",
        "credentialId",
        "trafficScopeId",
        "regionId",
        "instanceId",
        "name",
        "keepAlive",
        "shutdownMode",
        "schedule"
      ],
      where,
      issues
    );
    const id = readRequiredString(entry, "id", where, issues);
    const accountId = readRequiredString(entry, "accountId", where, issues);
    const credentialId = readRequiredString(entry, "credentialId", where, issues);
    const trafficScopeId = readRequiredString(entry, "trafficScopeId", where, issues);
    const regionId = readRequiredString(entry, "regionId", where, issues);
    const instanceId = readRequiredString(entry, "instanceId", where, issues);
    if (id === null || accountId === null || credentialId === null || trafficScopeId === null || regionId === null || instanceId === null) {
      continue;
    }
    if (instanceIds.has(id)) {
      issues.error("instances.id", `实例 id 重复：${id}`);
      continue;
    }
    instanceIds.add(id);
    if (!accountIds.has(accountId)) {
      issues.error("instances.accountId", `实例 ${id} 引用了不存在的账户 ${accountId}`, id);
    }
    if (!credentialIds.has(credentialId)) {
      issues.error("instances.credentialId", `实例 ${id} 引用了不存在的凭据 ${credentialId}`, id);
    }
    if (!scopeIds.has(trafficScopeId)) {
      issues.error("instances.trafficScopeId", `实例 ${id} 引用了不存在的流量范围 ${trafficScopeId}`, id);
    }
    const shutdownMode = entry["shutdownMode"];
    if (shutdownMode !== void 0 && shutdownMode !== "KeepCharging" && shutdownMode !== "StopCharging") {
      issues.error("shutdownMode", `实例 ${id} 的 shutdownMode 非法`, id);
    }
    instances.push({
      id,
      accountId,
      credentialId,
      trafficScopeId,
      regionId,
      instanceId,
      name: readOptionalString(entry, "name") ?? instanceId,
      keepAlive: readOptionalBoolean(entry, "keepAlive", false, `实例 ${id}`, issues),
      shutdownMode: shutdownMode === "StopCharging" ? "StopCharging" : "KeepCharging",
      schedule: readSchedule(entry["schedule"], `实例 ${id}`, issues)
    });
  }
  return { credentials, accounts, trafficScopes, instances };
}
function validateTimeZone(timeZone, issues, field = "CDT_TIMEZONE") {
  const provider = createTimeZoneProvider(timeZone);
  if (!provider.isReliable()) {
    issues.error(field, `无法在当前环境使用该时区：${timeZone}`);
    return false;
  }
  return true;
}
function parseThresholdAction(value, fallback, where, issues) {
  if (value === void 0) return fallback;
  if (value === "notify_only" || value === "stop_and_notify") return value;
  issues.error("thresholdAction", `${where} 的 thresholdAction 非法`);
  return fallback;
}

// src/config/parse.ts
var ENV_KEYS = {
  mode: "CDT_MODE",
  namespace: "CDT_NAMESPACE",
  accountId: "CDT_ACCOUNT_ID",
  accessKeyId: "CDT_ACCESS_KEY_ID",
  accessKeySecret: "CDT_ACCESS_KEY_SECRET",
  securityToken: "CDT_SECURITY_TOKEN",
  siteType: "CDT_SITE_TYPE",
  regionId: "CDT_REGION_ID",
  instanceId: "CDT_INSTANCE_ID",
  name: "CDT_NAME",
  quota: "CDT_QUOTA",
  quotaUnit: "CDT_QUOTA_UNIT",
  trafficClass: "CDT_TRAFFIC_CLASS",
  thresholdPercent: "CDT_THRESHOLD_PERCENT",
  refreshSeconds: "CDT_REFRESH_SECONDS",
  billingEnabled: "CDT_BILLING_ENABLED",
  localNotify: "CDT_LOCAL_NOTIFY",
  timezone: "CDT_TIMEZONE",
  debug: "CDT_DEBUG",
  baseUrl: "CDT_BASE_URL",
  readToken: "CDT_READ_TOKEN",
  allowInsecureHttp: "CDT_ALLOW_INSECURE_HTTP",
  accountsJson: "CDT_ACCOUNTS_JSON",
  notificationJson: "CDT_NOTIFICATION_JSON",
  controlJson: "CDT_CONTROL_JSON",
  telegramToken: "CDT_TELEGRAM_BOT_TOKEN",
  scopeId: "CDT_SCOPE_ID",
  instanceIds: "CDT_INSTANCE_IDS",
  theme: "CDT_THEME"
};
var DEFAULT_REFRESH_SECONDS = 900;
function emptyControlConfig() {
  return {
    schemaVersion: 1,
    // Everything below defaults to "off". Deleting the config is equivalent to
    // disabling it; there is no conflicting implicit switch.
    enabled: false,
    // Attests nothing. There is deliberately no env variable, module default or
    // code path that pre-fills this.
    deviceVerification: unverifiedDevice(),
    credentialId: null,
    allowedInstanceIds: [],
    scopes: [],
    instances: [],
    actionCooldownSeconds: 600,
    pauseUntil: null
  };
}
function emptyNotificationConfig(localNotify) {
  return {
    schemaVersion: 1,
    local: localNotify,
    telegram: { enabled: false, botToken: "", chatId: "" },
    webhook: { enabled: false, url: "", method: "POST", bodyTemplate: "" },
    dailyReport: { enabled: false, time: "22:00", compensationWindowMinutes: 20 }
  };
}
function readViewSelection(env) {
  return {
    scopeId: readString(env, ENV_KEYS.scopeId),
    instanceIds: readList(env, ENV_KEYS.instanceIds),
    theme: readString(env, ENV_KEYS.theme)
  };
}
function fnv1aHex(input) {
  let hash = 2166136261;
  for (const byte of utf8Bytes(input)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
function computeConfigFingerprint(config) {
  const identity = {
    mode: config.mode,
    namespace: config.namespace,
    credentials: config.credentials.map((credential) => ({
      id: credential.id,
      accountId: credential.accountId,
      // The AK id participates (a rotated key must invalidate caches) but the
      // secret never does: it must not reach cache keys.
      accessKeyId: credential.accessKeyId,
      siteType: credential.siteType
    })).sort((a, b) => a.id < b.id ? -1 : 1),
    accounts: config.accounts.map((account) => account.id).sort(),
    scopes: config.trafficScopes.map((scope) => ({
      id: scope.id,
      accountId: scope.accountId,
      credentialId: scope.credentialId,
      trafficClass: scope.trafficClass,
      quota: scope.quota,
      threshold: scope.thresholdPercent
    })).sort((a, b) => a.id < b.id ? -1 : 1),
    instances: config.instances.map((instance) => ({
      id: instance.id,
      accountId: instance.accountId,
      trafficScopeId: instance.trafficScopeId,
      regionId: instance.regionId,
      instanceId: instance.instanceId
    })).sort((a, b) => a.id < b.id ? -1 : 1),
    server: config.server === null ? null : config.server.baseUrl
  };
  return fnv1aHex(JSON.stringify(identity));
}
function parseControlConfig(value, knownCredentialIds, knownInstanceIds, issues) {
  const config = emptyControlConfig();
  if (value === void 0) return config;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    issues.error("CDT_CONTROL_JSON", "CDT_CONTROL_JSON 必须是 JSON 对象，控制保持关闭");
    return config;
  }
  const record = value;
  if (record["schemaVersion"] !== 1) {
    issues.error("CDT_CONTROL_JSON.schemaVersion", "不支持的 control schemaVersion，控制保持关闭");
    return config;
  }
  const knownKeys = [
    "schemaVersion",
    "enabled",
    "deviceVerification",
    "credentialId",
    "allowedInstanceIds",
    "scopes",
    "instances",
    "actionCooldownSeconds",
    "pauseUntil",
    // Shorthands for the common single-instance case.
    "verifiedOnDevice",
    "keepAlive"
  ];
  for (const key of Object.keys(record)) {
    if (!knownKeys.includes(key)) {
      issues.error("CDT_CONTROL_JSON", `CDT_CONTROL_JSON 含有未知字段 ${key}，控制保持关闭`);
      return config;
    }
  }
  if (record["enabled"] !== void 0 && typeof record["enabled"] !== "boolean") {
    issues.error("CDT_CONTROL_JSON.enabled", "enabled 必须是布尔值，控制保持关闭");
    return config;
  }
  config.enabled = record["enabled"] === true;
  const verifiedOnDevice = record["verifiedOnDevice"];
  if (verifiedOnDevice !== void 0) {
    if (typeof verifiedOnDevice !== "string" || !Number.isFinite(Date.parse(verifiedOnDevice))) {
      issues.error(
        "CDT_CONTROL_JSON.verifiedOnDevice",
        "verifiedOnDevice 必须是合法的 ISO 8601 日期，控制保持关闭"
      );
      config.enabled = false;
      return config;
    }
    if (record["deviceVerification"] !== void 0) {
      issues.error(
        "CDT_CONTROL_JSON",
        "verifiedOnDevice 与 deviceVerification 不能同时使用，控制保持关闭"
      );
      config.enabled = false;
      return config;
    }
    config.deviceVerification = {
      crossExecutionIntentClaim: true,
      hostSerializesSameTarget: true,
      verifiedAt: verifiedOnDevice,
      note: "verifiedOnDevice"
    };
  }
  const attestation = record["deviceVerification"];
  if (attestation !== void 0) {
    if (attestation === null || typeof attestation !== "object" || Array.isArray(attestation)) {
      issues.error(
        "CDT_CONTROL_JSON.deviceVerification",
        "deviceVerification 必须是对象，控制保持关闭"
      );
      config.enabled = false;
      return config;
    }
    const item = attestation;
    const allowed2 = ["crossExecutionIntentClaim", "hostSerializesSameTarget", "verifiedAt", "note"];
    for (const key of Object.keys(item)) {
      if (!allowed2.includes(key)) {
        issues.error(
          "CDT_CONTROL_JSON.deviceVerification",
          `deviceVerification 含未知字段 ${key}，控制保持关闭`
        );
        config.enabled = false;
        return config;
      }
    }
    for (const key of ["crossExecutionIntentClaim", "hostSerializesSameTarget"]) {
      if (item[key] !== void 0 && typeof item[key] !== "boolean") {
        issues.error(
          "CDT_CONTROL_JSON.deviceVerification",
          `${key} 必须是布尔值，控制保持关闭`
        );
        config.enabled = false;
        return config;
      }
    }
    const crossExecution = item["crossExecutionIntentClaim"] === true;
    const serialises = item["hostSerializesSameTarget"] === true;
    let verifiedAt = null;
    if (item["verifiedAt"] !== void 0 && item["verifiedAt"] !== null) {
      if (typeof item["verifiedAt"] !== "string" || !Number.isFinite(Date.parse(item["verifiedAt"]))) {
        issues.error(
          "CDT_CONTROL_JSON.deviceVerification.verifiedAt",
          "verifiedAt 必须是合法的 ISO 8601 日期或时间，控制保持关闭"
        );
        config.enabled = false;
        return config;
      }
      verifiedAt = item["verifiedAt"];
    }
    if ((crossExecution || serialises) && verifiedAt === null) {
      issues.error(
        "CDT_CONTROL_JSON.deviceVerification.verifiedAt",
        "声明已通过真机验证时必须同时填写 verifiedAt，控制保持关闭"
      );
      config.enabled = false;
      return config;
    }
    config.deviceVerification = {
      crossExecutionIntentClaim: crossExecution,
      hostSerializesSameTarget: serialises,
      verifiedAt,
      note: typeof item["note"] === "string" ? item["note"] : null
    };
  }
  const credentialId = record["credentialId"];
  if (credentialId !== void 0 && credentialId !== null) {
    if (typeof credentialId !== "string" || !knownCredentialIds.includes(credentialId)) {
      issues.error("CDT_CONTROL_JSON.credentialId", "控制凭据不存在，控制保持关闭");
      config.enabled = false;
      return config;
    }
    config.credentialId = credentialId;
  } else if (knownCredentialIds.length === 1) {
    config.credentialId = knownCredentialIds[0];
  }
  const cooldown = record["actionCooldownSeconds"];
  if (cooldown !== void 0) {
    if (typeof cooldown !== "number" || !Number.isFinite(cooldown) || cooldown < 0) {
      issues.error("CDT_CONTROL_JSON.actionCooldownSeconds", "actionCooldownSeconds 必须是非负数");
      config.enabled = false;
      return config;
    }
    config.actionCooldownSeconds = cooldown;
  }
  const pauseUntil = record["pauseUntil"];
  if (pauseUntil !== void 0 && pauseUntil !== null) {
    if (typeof pauseUntil !== "string" || !Number.isFinite(Date.parse(pauseUntil))) {
      issues.error("CDT_CONTROL_JSON.pauseUntil", "pauseUntil 必须是合法的 ISO 8601 时间");
      config.enabled = false;
      return config;
    }
    config.pauseUntil = pauseUntil;
  }
  const rawScopes = record["scopes"];
  if (rawScopes !== void 0) {
    if (!Array.isArray(rawScopes)) {
      issues.error("CDT_CONTROL_JSON.scopes", "scopes 必须是数组");
      config.enabled = false;
      return config;
    }
    for (const entry of rawScopes) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        issues.error("CDT_CONTROL_JSON.scopes", "scopes 中存在非对象条目");
        config.enabled = false;
        return config;
      }
      const item = entry;
      const scopeId = item["scopeId"];
      if (typeof scopeId !== "string" || scopeId === "") {
        issues.error("CDT_CONTROL_JSON.scopes", "scope 缺少 scopeId");
        config.enabled = false;
        return config;
      }
      if (item["thresholdStopEnabled"] !== void 0 && typeof item["thresholdStopEnabled"] !== "boolean") {
        issues.error(
          "CDT_CONTROL_JSON.scopes",
          `scope ${scopeId} 的 thresholdStopEnabled 必须是布尔值`,
          scopeId
        );
        config.enabled = false;
        return config;
      }
      config.scopes.push({
        scopeId,
        // notify_only is the safe default: turning control on must never
        // implicitly turn stopping on.
        thresholdAction: parseThresholdAction(
          item["thresholdAction"],
          "notify_only",
          `scope ${scopeId}`,
          issues
        ),
        thresholdStopEnabled: item["thresholdStopEnabled"] === true
      });
    }
  }
  const rawInstances = record["instances"];
  if (rawInstances !== void 0) {
    if (!Array.isArray(rawInstances)) {
      issues.error("CDT_CONTROL_JSON.instances", "instances 必须是数组");
      config.enabled = false;
      return config;
    }
    for (const entry of rawInstances) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        issues.error("CDT_CONTROL_JSON.instances", "instances 中存在非对象条目");
        config.enabled = false;
        return config;
      }
      const item = entry;
      const instanceId = item["instanceId"];
      if (typeof instanceId !== "string" || !knownInstanceIds.includes(instanceId)) {
        issues.error("CDT_CONTROL_JSON.instances", "控制 instances 引用了未知实例");
        config.enabled = false;
        return config;
      }
      const shutdownMode = item["shutdownMode"];
      if (shutdownMode !== void 0 && shutdownMode !== "KeepCharging" && shutdownMode !== "StopCharging") {
        issues.error(
          "CDT_CONTROL_JSON.instances",
          `实例 ${instanceId} 的 shutdownMode 非法`,
          instanceId
        );
        config.enabled = false;
        return config;
      }
      config.instances.push({
        instanceId,
        scheduleControlEnabled: item["scheduleControlEnabled"] === true,
        keepAlive: item["keepAlive"] === true,
        shutdownMode: shutdownMode === "StopCharging" ? "StopCharging" : "KeepCharging"
      });
    }
  }
  const allowed = record["allowedInstanceIds"];
  if (allowed !== void 0) {
    if (!Array.isArray(allowed)) {
      issues.error("CDT_CONTROL_JSON.allowedInstanceIds", "allowedInstanceIds 必须是数组");
      config.enabled = false;
      return config;
    }
    for (const entry of allowed) {
      if (typeof entry !== "string" || !knownInstanceIds.includes(entry)) {
        issues.error(
          "CDT_CONTROL_JSON.allowedInstanceIds",
          `控制白名单包含未知实例 ${String(entry)}，控制保持关闭`
        );
        config.enabled = false;
        return config;
      }
      config.allowedInstanceIds.push(entry);
    }
  } else {
    for (const policy of config.instances) {
      config.allowedInstanceIds.push(policy.instanceId);
    }
  }
  const keepAlive = record["keepAlive"];
  if (keepAlive !== void 0) {
    if (typeof keepAlive !== "boolean") {
      issues.error("CDT_CONTROL_JSON.keepAlive", "keepAlive 必须是布尔值，控制保持关闭");
      config.enabled = false;
      return config;
    }
    if (record["instances"] !== void 0 || record["allowedInstanceIds"] !== void 0) {
      issues.error(
        "CDT_CONTROL_JSON.keepAlive",
        "keepAlive 简写不能与 instances / allowedInstanceIds 同时使用，控制保持关闭"
      );
      config.enabled = false;
      return config;
    }
    if (knownInstanceIds.length === 0) {
      issues.error(
        "CDT_CONTROL_JSON.keepAlive",
        "没有可保活的实例：请先填写 CDT_INSTANCE_ID，控制保持关闭"
      );
      config.enabled = false;
      return config;
    }
    if (knownInstanceIds.length > 1) {
      issues.error(
        "CDT_CONTROL_JSON.keepAlive",
        `配置了 ${knownInstanceIds.length} 个实例，keepAlive 简写无法确定目标；请显式列出 allowedInstanceIds 与 instances`
      );
      config.enabled = false;
      return config;
    }
    const only = knownInstanceIds[0];
    config.allowedInstanceIds = [only];
    config.instances = [
      {
        instanceId: only,
        scheduleControlEnabled: false,
        keepAlive: keepAlive === true,
        shutdownMode: "KeepCharging"
      }
    ];
  }
  for (const policy of config.instances) {
    if (!config.allowedInstanceIds.includes(policy.instanceId)) {
      issues.error(
        "CDT_CONTROL_JSON",
        `实例 ${policy.instanceId} 有控制策略但不在 allowedInstanceIds 中，控制保持关闭`
      );
      config.enabled = false;
      return config;
    }
  }
  return config;
}
function parseNotificationConfig(value, localNotify, env, issues) {
  const config = emptyNotificationConfig(localNotify);
  if (value === void 0) return config;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    issues.error("CDT_NOTIFICATION_JSON", "CDT_NOTIFICATION_JSON 必须是 JSON 对象");
    return config;
  }
  const record = value;
  if (record["schemaVersion"] !== 1) {
    issues.error("CDT_NOTIFICATION_JSON.schemaVersion", "不支持的 notification schemaVersion");
    return config;
  }
  const telegram = record["telegram"];
  if (telegram !== void 0) {
    if (telegram === null || typeof telegram !== "object" || Array.isArray(telegram)) {
      issues.error("CDT_NOTIFICATION_JSON.telegram", "telegram 必须是对象");
    } else {
      const item = telegram;
      const token = readString(env, ENV_KEYS.telegramToken);
      const chatId = typeof item["chatId"] === "string" ? item["chatId"].trim() : "";
      const enabled = item["enabled"] === true;
      if (enabled && (token === null || chatId === "")) {
        issues.error(
          "CDT_NOTIFICATION_JSON.telegram",
          "启用 Telegram 通知需要 CDT_TELEGRAM_BOT_TOKEN 与 telegram.chatId"
        );
      } else {
        config.telegram = { enabled, botToken: token ?? "", chatId };
      }
    }
  }
  const webhook = record["webhook"];
  if (webhook !== void 0) {
    if (webhook === null || typeof webhook !== "object" || Array.isArray(webhook)) {
      issues.error("CDT_NOTIFICATION_JSON.webhook", "webhook 必须是对象");
    } else {
      const item = webhook;
      const url = typeof item["url"] === "string" ? item["url"].trim() : "";
      const enabled = item["enabled"] === true;
      const method = item["method"] === "PUT" ? "PUT" : "POST";
      if (enabled) {
        if (!/^https:\/\/[^\s]+$/.test(url)) {
          issues.error("CDT_NOTIFICATION_JSON.webhook.url", "Webhook 必须是 HTTPS 地址");
        } else {
          config.webhook = {
            enabled: true,
            url,
            method,
            bodyTemplate: typeof item["bodyTemplate"] === "string" ? item["bodyTemplate"] : ""
          };
        }
      }
    }
  }
  const daily = record["dailyReport"];
  if (daily !== void 0) {
    if (daily === null || typeof daily !== "object" || Array.isArray(daily)) {
      issues.error("CDT_NOTIFICATION_JSON.dailyReport", "dailyReport 必须是对象");
    } else {
      const item = daily;
      const time = normalizeClockTime(typeof item["time"] === "string" ? item["time"] : "");
      if (time === null) {
        issues.error("CDT_NOTIFICATION_JSON.dailyReport.time", "日报时间必须是合法 HH:mm");
      } else {
        const window = item["compensationWindowMinutes"];
        config.dailyReport = {
          enabled: item["enabled"] === true,
          time,
          compensationWindowMinutes: typeof window === "number" && Number.isFinite(window) && window >= 0 ? window : 20
        };
      }
    }
  }
  return config;
}
function parseConfig(env, view = readViewSelection(env)) {
  const issues = new IssueCollector();
  const mode = readEnum(env, ENV_KEYS.mode, ["direct", "server"], "direct", issues);
  const namespace = readString(env, ENV_KEYS.namespace) ?? "default";
  const displayName = readString(env, ENV_KEYS.name) ?? "CDT";
  const timezone = readString(env, ENV_KEYS.timezone) ?? "Asia/Shanghai";
  validateTimeZone(timezone, issues);
  const debug = readBoolean(env, ENV_KEYS.debug, false, issues);
  const billingEnabled = readBoolean(env, ENV_KEYS.billingEnabled, false, issues);
  const localNotify = readBoolean(env, ENV_KEYS.localNotify, false, issues);
  const refreshSeconds = readNonNegativeInteger(
    env,
    ENV_KEYS.refreshSeconds,
    DEFAULT_REFRESH_SECONDS,
    issues
  );
  let credentials = [];
  let accounts = [];
  let trafficScopes = [];
  let instances = [];
  const advancedRaw = readJson(env, ENV_KEYS.accountsJson, issues);
  if (advancedRaw === null) {
    issues.error(
      ENV_KEYS.accountsJson,
      "CDT_ACCOUNTS_JSON 无法解析；不会回退到简单模式以免产生重复账号"
    );
  }
  if (advancedRaw !== void 0 && advancedRaw !== null) {
    const model = parseAdvancedModel(advancedRaw, issues);
    if (model === null) {
      return { ok: false, issues: issues.issues };
    }
    credentials = model.credentials;
    accounts = model.accounts;
    trafficScopes = model.trafficScopes;
    instances = model.instances;
    if (readString(env, ENV_KEYS.accessKeyId) !== null) {
      issues.warn(
        ENV_KEYS.accessKeyId,
        "已设置 CDT_ACCOUNTS_JSON，简单模式凭据字段被忽略，以避免同一账号被重复计数"
      );
    }
  } else {
    const built = buildSimpleModel(env, mode, namespace, displayName, timezone, issues);
    credentials = built.credentials;
    accounts = built.accounts;
    trafficScopes = built.trafficScopes;
    instances = built.instances;
  }
  let server = null;
  if (mode === "server") {
    const rawBaseUrl = readString(env, ENV_KEYS.baseUrl);
    const token = readString(env, ENV_KEYS.readToken);
    const allowInsecure = readBoolean(env, ENV_KEYS.allowInsecureHttp, false, issues);
    if (rawBaseUrl === null) {
      issues.error(ENV_KEYS.baseUrl, "server 模式必须设置 CDT_BASE_URL");
    } else if (token === null) {
      issues.error(ENV_KEYS.readToken, "server 模式必须设置 CDT_READ_TOKEN（widget:read Key）");
    } else {
      const normalized = normalizeServerBaseUrl(rawBaseUrl, allowInsecure);
      if (!normalized.ok) {
        issues.error(ENV_KEYS.baseUrl, normalized.reason);
      } else {
        server = {
          baseUrl: normalized.baseUrl,
          token,
          allowInsecureHttp: allowInsecure
        };
      }
    }
  } else if (readString(env, ENV_KEYS.baseUrl) !== null) {
    issues.warn(ENV_KEYS.baseUrl, "direct 模式下 CDT_BASE_URL 不会被使用");
  }
  const knownCredentialIds = credentials.map((credential) => credential.id);
  const knownInstanceIds = instances.map((instance) => instance.id);
  const control = parseControlConfig(
    readJson(env, ENV_KEYS.controlJson, issues),
    knownCredentialIds,
    knownInstanceIds,
    issues
  );
  if (mode === "server" && control.enabled) {
    issues.error(
      ENV_KEYS.controlJson,
      "server 模式不提供本地云写控制（该模式没有云端凭据）；保活已关闭，请改用 direct 模式，或由 Go 后端执行实例操作"
    );
    control.enabled = false;
  }
  const notifications = parseNotificationConfig(
    readJson(env, ENV_KEYS.notificationJson, issues),
    localNotify,
    env,
    issues
  );
  if (billingEnabled && mode === "server" && server === null) {
    issues.warn(ENV_KEYS.billingEnabled, "server 模式未配置成功，账单查询将被跳过");
  }
  const config = {
    mode,
    namespace,
    accountLabel: readString(env, ENV_KEYS.accountId) ?? "main",
    displayName,
    timezone,
    debug,
    refreshSeconds,
    billingEnabled,
    localNotify,
    credentials,
    accounts,
    trafficScopes,
    instances,
    control,
    notifications,
    server,
    view,
    configFingerprint: ""
  };
  config.configFingerprint = computeConfigFingerprint(config);
  if (issues.globalErrors().length > 0) {
    return { ok: false, issues: issues.issues };
  }
  return { ok: true, config, issues: issues.issues };
}
function buildSimpleModel(env, mode, namespace, displayName, timezone, issues) {
  const accountLabel = readString(env, ENV_KEYS.accountId) ?? "main";
  const credentials = [];
  const accounts = [];
  const trafficScopes = [];
  const instances = [];
  const accountId = `account-${accountLabel}`;
  accounts.push({ id: accountId, name: displayName, aliyunUid: null });
  const regionId = readString(env, ENV_KEYS.regionId) ?? "cn-hongkong";
  const siteType = readEnum(
    env,
    ENV_KEYS.siteType,
    ["china", "international"],
    "china",
    issues
  );
  const credentialId = `cred-${accountLabel}`;
  if (mode === "direct") {
    const accessKeyId = readString(env, ENV_KEYS.accessKeyId);
    const accessKeySecret = readString(env, ENV_KEYS.accessKeySecret);
    if (accessKeyId === null) {
      issues.error(ENV_KEYS.accessKeyId, "direct 模式必须设置只读 RAM 的 AccessKey ID");
    }
    if (accessKeySecret === null) {
      issues.error(ENV_KEYS.accessKeySecret, "direct 模式必须设置只读 RAM 的 AccessKey Secret");
    }
    const securityToken = readString(env, ENV_KEYS.securityToken);
    if (accessKeyId !== null && accessKeySecret !== null) {
      credentials.push({
        id: credentialId,
        accountId,
        accessKeyId,
        accessKeySecret,
        siteType,
        ...securityToken !== null ? { securityToken } : {}
      });
    }
  } else {
    credentials.push({
      id: credentialId,
      accountId,
      accessKeyId: "server-mode",
      accessKeySecret: "",
      siteType
    });
  }
  const explicitClass = readEnum(
    env,
    ENV_KEYS.trafficClass,
    ["auto", "mainland", "overseas"],
    "auto",
    issues
  );
  const trafficClass = explicitClass === "auto" ? trafficClassOfRegion(regionId) : explicitClass;
  let quota = null;
  const quotaRaw = readString(env, ENV_KEYS.quota);
  if (quotaRaw !== null) {
    if (!/^\d+(\.\d+)?$/.test(quotaRaw)) {
      issues.error(ENV_KEYS.quota, "CDT_QUOTA 必须是正数");
    } else {
      const value = Number(quotaRaw);
      if (!Number.isFinite(value) || value <= 0) {
        issues.error(ENV_KEYS.quota, "CDT_QUOTA 必须大于 0");
      } else {
        const unit = readEnum(
          env,
          ENV_KEYS.quotaUnit,
          ["GB", "GiB"],
          "GB",
          issues
        );
        quota = { value, unit, source: "user" };
      }
    }
  }
  const thresholdPercent = validateThresholdSafe(
    readNumber(env, ENV_KEYS.thresholdPercent, 95, issues),
    issues
  );
  const scopeId = `scope-${accountLabel}-${trafficClass}`;
  trafficScopes.push({
    id: scopeId,
    accountId,
    credentialId,
    trafficClass,
    quota,
    thresholdPercent,
    controlTargets: []
  });
  const instanceIdRaw = readString(env, ENV_KEYS.instanceId);
  if (instanceIdRaw !== null) {
    instances.push({
      id: `instance-${accountLabel}`,
      accountId,
      credentialId,
      trafficScopeId: scopeId,
      regionId,
      instanceId: instanceIdRaw,
      name: displayName,
      keepAlive: false,
      shutdownMode: "KeepCharging",
      // Simple mode never enables a schedule; scheduling is an explicit
      // advanced/control concern, and a disabled schedule here means the direct
      // monitoring path cannot start or stop anything.
      schedule: { enabled: false, start: "08:00", stop: "23:30" }
    });
  }
  return { credentials, accounts, trafficScopes, instances };
}
function validateThresholdSafe(value, issues) {
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    issues.error(ENV_KEYS.thresholdPercent, "CDT_THRESHOLD_PERCENT 必须落在 (0, 100]");
    return 95;
  }
  return value;
}

// src/host/egern.ts
function createClock() {
  return {
    now: () => /* @__PURE__ */ new Date()
  };
}
function detectRandomSource() {
  const candidate = globalThis["crypto"];
  if (candidate === null || typeof candidate !== "object") return null;
  const getRandomValues = candidate["getRandomValues"];
  if (typeof getRandomValues !== "function") return null;
  return candidate;
}
function createNonceFactory() {
  const source = detectRandomSource();
  let counter = 0;
  if (source !== null) {
    return {
      create() {
        const bytes = new Uint8Array(16);
        try {
          source.getRandomValues(bytes);
          return hexEncode(Array.from(bytes));
        } catch {
          counter++;
          return degraded(counter);
        }
      },
      describe: () => "crypto.getRandomValues（宿主提供）",
      isCryptographicallyStrong: () => true
    };
  }
  return {
    create() {
      counter++;
      return degraded(counter);
    },
    describe: () => "时间戳 + 计数器 + Math.random（宿主未提供安全随机数，不视为加密安全）",
    isCryptographicallyStrong: () => false
  };
}
function degraded(counter) {
  const random = Math.floor(Math.random() * 4294967296) >>> 0;
  const part = (value, width) => value.toString(16).padStart(width, "0").slice(-width);
  return part(Date.now() >>> 0, 8) + part(Math.floor(Date.now() / 4294967296) >>> 0, 4) + part(counter >>> 0, 4) + part(random, 8);
}
function wrapHttp(ctx) {
  const invoke = async (method, url, options) => {
    const response = await ctx.http[method](url, options);
    return {
      status: response.status,
      text: () => response.text()
    };
  };
  return {
    get: (url, options) => invoke("get", url, options),
    post: (url, options) => invoke("post", url, options)
  };
}
function wrapStorage(ctx) {
  const safeGet = (key) => {
    try {
      const value = ctx.storage.get(key);
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  };
  return {
    get: safeGet,
    set: (key, value) => {
      ctx.storage.set(key, value);
    },
    getJSON: (key) => {
      try {
        return ctx.storage.getJSON(key);
      } catch {
        return null;
      }
    },
    setJSON: (key, value) => {
      ctx.storage.setJSON(key, value);
    },
    delete: (key) => {
      try {
        ctx.storage.delete(key);
      } catch {
      }
    }
  };
}
function wrapNotifier(ctx) {
  return {
    notify(options) {
      ctx.notify(options);
    }
  };
}
function readEnvMap(ctx) {
  const result = {};
  const source = ctx.env;
  if (source === null || typeof source !== "object") return result;
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

// src/providers/aliyun/rpc.ts
var MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

// src/services/cache.ts
var CACHE_VERSION = "v1";
var CACHE_BUDGET_BYTES = 256 * 1024;
function cacheKey(namespace, provider, entityId, kind) {
  return `cdt:egern:${CACHE_VERSION}:${namespace}:${provider}:${entityId}:${kind}`;
}
function safeEntityId(entityId) {
  return entityId.replace(/[^A-Za-z0-9._:-]/g, "_");
}
var Cache = class {
  constructor(options) {
    __publicField(this, "options");
    this.options = options;
  }
  keyFor(entityId, kind) {
    return cacheKey(
      this.options.namespace,
      this.options.provider,
      safeEntityId(entityId),
      kind
    );
  }
  /**
   * Read and validate one cached value.
   *
   * Returns null for: absent, unparseable JSON, wrong envelope version, mismatched
   * identity, or a payload that fails its own validator. Never throws.
   */
  read(entityId, kind, validate) {
    let raw;
    try {
      raw = this.options.store.getJSON(this.keyFor(entityId, kind));
    } catch {
      return null;
    }
    if (raw === null || raw === void 0) return null;
    if (typeof raw !== "object") return null;
    const envelope = raw;
    if (envelope["cacheVersion"] !== 1) return null;
    if (envelope["namespace"] !== this.options.namespace) return null;
    if (envelope["provider"] !== this.options.provider) return null;
    if (envelope["fingerprint"] !== this.options.fingerprint) return null;
    try {
      return validate(envelope["data"]);
    } catch {
      return null;
    }
  }
  /** Write one cached value. Returns the encoded size in bytes, or null. */
  write(entityId, kind, data, now) {
    const envelope = {
      cacheVersion: 1,
      namespace: this.options.namespace,
      provider: this.options.provider,
      fingerprint: this.options.fingerprint,
      writtenAt: now.toISOString(),
      data
    };
    let encoded;
    try {
      encoded = JSON.stringify(envelope);
    } catch {
      return null;
    }
    try {
      this.options.store.set(this.keyFor(entityId, kind), encoded);
    } catch {
      return null;
    }
    return encoded.length;
  }
  /** Remove one cached value. */
  remove(entityId, kind) {
    try {
      this.options.store.delete(this.keyFor(entityId, kind));
    } catch {
    }
  }
  /** Raw text length of a cached value, for budget accounting. */
  sizeOf(entityId, kind) {
    try {
      const raw = this.options.store.get(this.keyFor(entityId, kind));
      return raw === null ? 0 : raw.length;
    } catch {
      return 0;
    }
  }
  /** Key used for an entity/kind, exposed for diagnostics and tests. */
  keyOf(entityId, kind) {
    return this.keyFor(entityId, kind);
  }
};

// src/entries/runtime.ts
var WIDGET_BUDGET_MS = 15e3;
function prepareRuntime(ctx, budgetMs) {
  const env = readEnvMap(ctx);
  const outcome = parseConfig(env);
  if (!outcome.ok) {
    return { ok: false, issues: outcome.issues };
  }
  const config = outcome.config;
  const clock = createClock();
  const storage = wrapStorage(ctx);
  return {
    ok: true,
    runtime: {
      env,
      config,
      issues: outcome.issues,
      cache: new Cache({
        store: storage,
        namespace: config.namespace,
        provider: config.mode,
        fingerprint: config.configFingerprint
      }),
      clock,
      nonce: createNonceFactory(),
      http: wrapHttp(ctx),
      storage,
      notifier: wrapNotifier(ctx),
      deadlineMs: clock.now().getTime() + budgetMs
    }
  };
}

// src/services/control.ts
function capabilityFromConfig(config) {
  const attestation = config.control.deviceVerification;
  return {
    crossExecutionIntentClaim: attestation.crossExecutionIntentClaim === true,
    hostSerializesSameTarget: attestation.hostSerializesSameTarget === true
  };
}
function describeCapability(config) {
  const attestation = config.control.deviceVerification;
  const capability = capabilityFromConfig(config);
  if (capability.crossExecutionIntentClaim && capability.hostSerializesSameTarget) {
    return `已声明通过真机验证（${attestation.verifiedAt ?? "未注明时间"}）`;
  }
  const missing = [];
  if (!capability.crossExecutionIntentClaim) missing.push("跨执行意图持久化");
  if (!capability.hostSerializesSameTarget) missing.push("同目标串行执行");
  return `未验证（缺少：${missing.join("、")}）`;
}
function controlFingerprint(config) {
  const control = config.control;
  const identity = JSON.stringify({
    enabled: control.enabled,
    credentialId: control.credentialId,
    allowed: [...control.allowedInstanceIds].sort(),
    attestation: {
      cross: control.deviceVerification.crossExecutionIntentClaim,
      serial: control.deviceVerification.hostSerializesSameTarget,
      verifiedAt: control.deviceVerification.verifiedAt
    },
    instances: control.instances.map((policy) => ({
      id: policy.instanceId,
      keepAlive: policy.keepAlive,
      schedule: policy.scheduleControlEnabled,
      shutdown: policy.shutdownMode
    })).sort((a, b) => a.id < b.id ? -1 : 1),
    scopes: control.scopes.map((scope) => ({
      id: scope.scopeId,
      stop: scope.thresholdStopEnabled,
      action: scope.thresholdAction
    })).sort((a, b) => a.id < b.id ? -1 : 1),
    cooldown: control.actionCooldownSeconds,
    pauseUntil: control.pauseUntil
  });
  return hexEncode(sha1(utf8Bytes(identity))).slice(0, 12);
}

// src/services/runlog.ts
var RUN_LOG_ENTITY = "automation";
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function validateRunLog(value) {
  if (value === null || typeof value !== "object") return null;
  const record = value;
  if (typeof record["at"] !== "string") return null;
  const mode = record["mode"];
  if (mode !== "dry-run" && mode !== "live") return null;
  if (typeof record["scopeCount"] !== "number" || typeof record["instanceCount"] !== "number") {
    return null;
  }
  const controlFingerprint2 = typeof record["controlFingerprint"] === "string" ? record["controlFingerprint"] : null;
  const decisions = [];
  if (Array.isArray(record["decisions"])) {
    for (const item of record["decisions"]) {
      if (item === null || typeof item !== "object") return null;
      const entry = item;
      if (typeof entry["kind"] !== "string" || typeof entry["reason"] !== "string") return null;
      decisions.push({
        kind: entry["kind"],
        instanceId: typeof entry["instanceId"] === "string" ? entry["instanceId"] : null,
        scopeId: typeof entry["scopeId"] === "string" ? entry["scopeId"] : null,
        reason: entry["reason"]
      });
    }
  }
  const blocked = [];
  if (Array.isArray(record["blocked"])) {
    for (const item of record["blocked"]) {
      if (item === null || typeof item !== "object") return null;
      const entry = item;
      if (typeof entry["entityId"] !== "string" || typeof entry["code"] !== "string" || typeof entry["reason"] !== "string") {
        return null;
      }
      blocked.push({
        entityId: entry["entityId"],
        code: entry["code"],
        reason: entry["reason"]
      });
    }
  }
  const writes = [];
  if (Array.isArray(record["writes"])) {
    for (const item of record["writes"]) {
      if (item === null || typeof item !== "object") return null;
      const entry = item;
      if (typeof entry["action"] !== "string" || typeof entry["code"] !== "string") return null;
      if (typeof entry["message"] !== "string") return null;
      writes.push({
        instanceId: typeof entry["instanceId"] === "string" ? entry["instanceId"] : null,
        action: entry["action"],
        code: entry["code"],
        message: entry["message"]
      });
    }
  }
  return {
    at: record["at"],
    mode,
    controlFingerprint: controlFingerprint2,
    scopeCount: record["scopeCount"],
    instanceCount: record["instanceCount"],
    decisions,
    blocked,
    writes
  };
}
function readRunLog(cache) {
  return cache.read(RUN_LOG_ENTITY, "run-log", validateRunLog);
}

// src/entries/diagnostics.ts
function detectGlobal(name) {
  try {
    return typeof globalThis[name] !== "undefined";
  } catch {
    return false;
  }
}
function describeFeature(name, present) {
  return present ? "可用" : "不可用";
}
function runProbes(ctx) {
  const probes = [];
  const hasCrypto = detectGlobal("crypto");
  const hasGetRandomValues = (() => {
    const candidate = globalThis["crypto"];
    if (candidate === null || typeof candidate !== "object") return false;
    return typeof candidate["getRandomValues"] === "function";
  })();
  probes.push({
    label: "crypto.getRandomValues",
    value: hasGetRandomValues ? "可用（宿主提供）" : hasCrypto ? "存在但无 getRandomValues" : "不可用",
    ok: hasGetRandomValues
  });
  probes.push({
    label: "TextEncoder",
    value: describeFeature("TextEncoder", detectGlobal("TextEncoder")),
    ok: detectGlobal("TextEncoder")
  });
  probes.push({
    label: "btoa/atob",
    value: describeFeature("btoa", typeof globalThis["btoa"] === "function"),
    ok: typeof globalThis["btoa"] === "function"
  });
  probes.push({
    label: "fetch",
    value: describeFeature("fetch", detectGlobal("fetch")),
    ok: detectGlobal("fetch")
  });
  probes.push({
    label: "Buffer/process",
    value: detectGlobal("Buffer") || detectGlobal("process") ? "存在（本项目不依赖）" : "不可用（符合预期）",
    ok: null
  });
  probes.push({
    label: "Intl.DateTimeFormat",
    value: describeFeature("Intl", detectGlobal("Intl")),
    ok: detectGlobal("Intl")
  });
  probes.push({ label: "ctx.http", value: ctx.http === void 0 ? "缺失" : "可用", ok: ctx.http !== void 0 });
  probes.push({ label: "ctx.storage", value: ctx.storage === void 0 ? "缺失" : "可用", ok: ctx.storage !== void 0 });
  probes.push({ label: "ctx.notify", value: typeof ctx.notify === "function" ? "可用" : "缺失", ok: typeof ctx.notify === "function" });
  probes.push({
    label: "ctx.widgetFamily",
    value: ctx.widgetFamily === void 0 ? "未提供（手动运行）" : ctx.widgetFamily,
    ok: null
  });
  probes.push({
    label: "ctx.cron",
    value: ctx.cron === void 0 ? "未提供" : ctx.cron,
    ok: null
  });
  probes.push({
    label: "ctx.app.version",
    value: ctx.app?.version ?? "未知",
    ok: null
  });
  probes.push({
    label: "ctx.app.language",
    value: ctx.app?.language ?? "未知",
    ok: null
  });
  probes.push(probeStorage(ctx));
  return probes;
}
var storageProbeCounter = 0;
function probeStorage(ctx) {
  const key = "cdt:egern:v1:diagnostics:probe";
  try {
    storageProbeCounter++;
    const token = `probe-${Date.now()}-${storageProbeCounter}`;
    ctx.storage.set(key, token);
    const readBack = ctx.storage.get(key);
    const json = ctx.storage.getJSON("cdt:egern:v1:diagnostics:missing");
    const ok = readBack === token;
    return {
      label: "storage 写入/读回",
      value: ok ? json === null ? "同步读写正常，缺失键返回 null" : "读回正常，但缺失键未返回 null（与文档不符）" : "写入后无法读回",
      ok
    };
  } catch {
    return { label: "storage 写入/读回", value: "抛出异常", ok: false };
  }
}
function summarizeIssues(issues) {
  return issues.slice(0, 6).map((issue) => {
    const severity = issue.severity === "error" ? "错误" : "警告";
    return `${severity} · ${issue.field}`;
  });
}
async function main(ctx) {
  const prepared = prepareRuntime(ctx, WIDGET_BUDGET_MS);
  const probes = runProbes(ctx);
  if (!prepared.ok) {
    return renderReport(
      "CDT Monitor 诊断",
      "配置存在错误，以下为该环境的探测结果",
      [...summarizeIssues(prepared.issues), "— 能力探测 —", ...groupProbes(probes)],
      false
    );
  }
  const { config, issues } = prepared.runtime;
  const lines = [
    `数据来源：${config.mode === "direct" ? "直连阿里云" : "自建服务器"}`,
    `命名空间：${config.namespace}`,
    `业务时区：${config.timezone}`,
    `账户 ${config.accounts.length} · 流量范围 ${config.trafficScopes.length} · 实例 ${config.instances.length}`,
    `AccessKey：${config.credentials.some((credential) => credential.accessKeySecret !== "") ? "已配置" : "未配置"}`,
    `账单 ${config.billingEnabled ? "开" : "关"} · 本地通知 ${config.localNotify ? "开" : "关"} · 控制 ${config.control.enabled ? "开" : "关（默认）"}`,
    `写入能力：${describeCapability(config)}`,
    // These identifiers appear in CDT_CONTROL_JSON but nowhere in the UI, so
    // without printing them a user writing the explicit form has to guess.
    `控制配置指纹：${controlFingerprint(config)}`,
    `可引用 id：${[
      ...config.credentials.map((credential) => `凭据=${credential.id}`),
      ...config.instances.map((instance) => `实例=${instance.id}`)
    ].join(" ") || "（无）"}`
  ];
  const problems = summarizeIssues(issues);
  if (problems.length > 0) {
    lines.push("— 配置问题 —", ...problems);
  }
  lines.push("— 上次自动策略 —", ...describeLastRun(prepared.runtime, controlFingerprint(config)));
  lines.push("— 能力探测 —", ...groupProbes(probes));
  const healthy = issues.every((issue) => issue.severity !== "error");
  return renderReport(
    "CDT Monitor 诊断",
    healthy ? "环境与配置检查完成" : "存在配置错误",
    lines,
    healthy
  );
}
function describeLastRun(runtime, ownFingerprint) {
  const entry = readRunLog(runtime.cache);
  if (entry === null) {
    return [
      "暂无记录（等待定时脚本跑过一次）",
      "注意：跨脚本读取缓存的能力未经实机验证；收不到记录不代表没运行"
    ];
  }
  const lines = [
    `运行于 ${entry.at}（${formatAge(entry.at, runtime.clock.now())}）`,
    `模式：${entry.mode === "live" ? "实际执行" : "仅演练（未声明真机验证，不会写入）"}`,
    `范围 ${entry.scopeCount} · 实例 ${entry.instanceCount} · 决策 ${entry.decisions.length} · 阻止 ${entry.blocked.length} · 动作 ${entry.writes.length}`
  ];
  for (const decision of entry.decisions) {
    lines.push(`决策 ${decision.kind}${decision.instanceId === null ? "" : ` ${decision.instanceId}`}`);
  }
  for (const write of entry.writes) {
    lines.push(`动作 ${write.action} → ${write.code}${write.instanceId === null ? "" : ` ${write.instanceId}`}`);
  }
  for (const block of entry.blocked.slice(0, 2)) {
    lines.push(`阻止 ${block.code}：${block.reason}`);
  }
  return lines;
}
function formatAge(iso, now) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "时间未知";
  const minutes = Math.floor((now.getTime() - parsed) / 6e4);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
function groupProbes(probes) {
  const find = (label) => {
    const probe = probes.find((item) => item.label === label);
    if (probe === void 0) return "?";
    if (probe.value === "可用") return "可用";
    if (probe.value.startsWith("不可用")) return "无";
    if (probe.value.startsWith("未提供")) return "未提供";
    if (probe.value.startsWith("存在")) return "有(不依赖)";
    if (probe.value.startsWith("同步读写正常")) return "正常";
    return probe.value.length <= 16 ? probe.value : `${probe.value.slice(0, 15)}…`;
  };
  return [
    `全局：crypto=${find("crypto.getRandomValues")} TextEncoder=${find("TextEncoder")} btoa=${find("btoa/atob")} fetch=${find("fetch")}`,
    `ctx：http=${find("ctx.http")} storage=${find("ctx.storage")} notify=${find("ctx.notify")}`,
    `上下文：family=${find("ctx.widgetFamily")} cron=${find("ctx.cron")} app=${find("ctx.app.version")}`,
    `时区：${find("Intl.DateTimeFormat")} · 存储：${find("storage 写入/读回")}`,
    `Node 全局：${find("Buffer/process")}`
  ];
}
function renderReport(title, subtitle, lines, healthy) {
  const children = [
    { type: "text", text: title, font: { size: "headline", weight: "semibold" }, maxLines: 1 },
    {
      type: "text",
      text: subtitle,
      font: { size: "caption1", weight: "medium" },
      textColor: healthy ? { light: "#1B7A3A", dark: "#4CD964" } : { light: "#C0271D", dark: "#FF6B60" },
      maxLines: 2
    }
  ];
  for (const line of lines.slice(0, 18)) {
    children.push({ type: "text", text: line, font: { size: "caption2" }, maxLines: 1, minScale: 0.8 });
  }
  return { type: "widget", children, padding: 14, gap: 3 };
}
export {
  main as default,
  runProbes,
  summarizeIssues
};
