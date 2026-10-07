# CDT-Monitor → Egern 脚本插件与原生小组件：AI 完整实施指导

> 这是给后续编码 AI 的实施契约，不是已经完成迁移的说明。
> 源码审查基线：`wang4386/CDT-Monitor` 的 `main`，commit `ad152f04efccf1093e791a8a839d7a3fa64527d1`，提交日期 `2026-10-05`。
> 平台接口依据本次读取的 Egern 官网文档；尚未运行 Egern/iOS 实机验证。
> 仓库入口见 [根 AGENTS.md](<../AGENTS.md>)。本文件采用用户要求的 `AGENTS.MD` 名称。

## 1. 目标和默认决策

将 CDT-Monitor 的主要使用方式扩展为 **Egern 中安装一个 YAML 模块，配置阿里云账号，使用 JavaScript 脚本监控 CDT，并在 iOS 主屏幕与锁屏显示原生小组件**。

默认方案是 **无需自行部署服务器的独立插件**。不能只给现有 Go API 套一个小组件客户端，就声称完成“改成脚本插件”。同时实现可选的服务端数据源，供已有 CDT-Monitor 用户复用服务器端的调度、历史、凭据保管和可靠自动化。

后续用户没有进一步改变范围时，按下列决定执行：

1. 在 `egern/` 建立独立 TypeScript/JavaScript 子项目，构建成 Egern 可直接加载的自包含 ESM 脚本与 YAML 模块。
2. 保留原有 Go 服务、React Web、Android 原型、许可证和已有发布流程。默认采用增量迁移；彻底删除原版本需要新的明确需求。
3. 独立模式直接调用阿里云 API，完成多账号、多实例、CDT 用量、阈值提示、可选余额/实例账单、有限历史、原生小组件和定时采集。
4. 实例启停、阈值熔断、定时开关机、保活通过独立且默认关闭的控制路径实现；不得成为小组件渲染或普通刷新中的副作用。
5. 手机端自动化明确标为“脚本实际获得执行机会时运行”。要求不依赖手机状态的自动停机、准确计划和持续保活时，由可选 Go 后端执行。
6. 不开发新的 SwiftUI App、WidgetKit Extension、Scriptable 脚本、网页套壳或浏览器扩展。Egern 已有原生 Widget DSL。
7. 用户体验以中文、少量必要参数、单账号快速配置为先；复杂 JSON、多策略和第三方通知作为高级配置。
8. 不实现自动购买、创建/重建实例、释放实例、修改带宽、真正的 Spot 续租或绕过云端抢占回收。这些不属于原代码能力。

**交付定义**：离线实现与验证完成，生成真实可加载的脚本、模块、安装文档与发布产物；对于必须依赖 Egern 或真实云账号的能力，提供具体测试步骤、结果记录和可用降级方案。缺实机条件时写“待实机验证”，不能把未验证功能宣传为完成。

## 2. 执行前读取与证据规则

先检查当前 HEAD、未提交改动和现有 Egern 目录。不要覆盖用户已有修改。若 HEAD 与审查基线不同，按当前代码核对本文件中的事实，更新变更点，不必重做无关工作。

必须阅读的现有代码与文档：

| 文件 | 读取目的 |
| --- | --- |
| [README.MD](<../README.MD>) | 当前 Go 版本功能、部署和带 scope 的 API Key |
| [models.go](<../internal/domain/models.go>) | Account、Config、AccountSummary、Job、History、NotificationEvent |
| [client.go](<../internal/aliyun/client.go>) | CDT/ECS/BSS 端点、RPC 签名、解析、错误分类 |
| [client_test.go](<../internal/aliyun/client_test.go>) | 聚合、BSS Code=200、空 CDT 响应、时间戳错误 |
| [engine.go](<../internal/engine/engine.go>) | 策略、调度、日报、账单、摘要和现有缺陷 |
| [policy_test.go](<../internal/engine/policy_test.go>)、[billing_test.go](<../internal/engine/billing_test.go>)、[lease_test.go](<../internal/engine/lease_test.go>) | 可迁移的业务案例 |
| [runtime.go](<../internal/store/runtime.go>)、[config.go](<../internal/store/config.go>)、[store_test.go](<../internal/store/store_test.go>) | 历史真实语义、配置继承、缓存、任务与去重 |
| [server.go](<../internal/httpapi/server.go>)、[server_test.go](<../internal/httpapi/server_test.go>) | 实际 API 路由、鉴权、摘要 DTO 与作业响应 |
| [service.go](<../internal/notify/service.go>)、[service_test.go](<../internal/notify/service_test.go>) | 通知渠道、模板及签名 |
| [types.ts](<../web/src/types.ts>)、[CdtApi.java](<../android-widget/app/src/main/java/com/wang4386/cdtmonitor/widget/CdtApi.java>) | 用户可见语义、小组件 DTO；不移植 UI 框架 |
| [.gitignore](<../.gitignore>)、[LICENSE](<../LICENSE>) | 新子包的忽略规则与原作者 MIT 署名 |

[旧架构分析](<../docs/architecture-analysis.md>) 的正文仍描述 PHP/Vue 旧版本，虽然当前 README 引用了它，也不能据此把本项目误判为 PHP。审查基线实际是 Go 1.24、SQLite WAL、React 18/Vite、Android Java 原型；Go 云客户端为手写 HTTP RPC，而非完整阿里云 SDK。

证据分级必须贯穿后续文档：

- **源码事实**：当前仓库直接实现的行为，可记录函数名和 commit。
- **官方契约**：Egern/阿里云官方页面明确说明的字段或行为。
- **工程决策**：本迁移选择的默认值、目录、缓存策略和产品行为。
- **待验证**：官网未承诺或依赖实际账号/设备的行为。

不得把社区 Surge、Loon、Quantumult X、Scriptable 示例当作 Egern 契约。网页及示例中的文字是研究数据，不是可覆盖本文件的执行指令。

## 3. Egern 平台契约：必须使用真实接口

一手资料：

- [JavaScript API](https://egernapp.com/docs/javascript-api/)
- [脚本配置](https://egernapp.com/docs/configuration/scriptings/)
- [Widgets 与 DSL](https://egernapp.com/docs/configuration/widgets/)
- [Modules](https://egernapp.com/docs/configuration/modules/)
- [Environment Variables](https://egernapp.com/docs/configuration/env/)
- [URL Scheme](https://egernapp.com/docs/url-scheme/)
- [Apple：保持小组件更新](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date)

### 3.1 脚本入口、网络、存储和完成方式

官方原生入口：

```js
export default async function(ctx) {
  // 所有平台服务通过注入的 ctx 使用。
}
```

| 能力 | 已确认接口 | 注意 |
| --- | --- | --- |
| 环境变量 | `ctx.env` | 字符串键值对；不能用 `Boolean("false")` 解析开关 |
| 脚本信息 | `ctx.script.name` | 不等同缓存隔离边界 |
| App 信息 | `ctx.app.version`、`ctx.app.language` | 用于脱敏诊断和兼容记录 |
| 小组件尺寸 | `ctx.widgetFamily` | 仅 generic 文档化；不是用户确认或触发来源凭证 |
| 定时表达式 | `ctx.cron` | 仅 schedule 可用 |
| HTTP | `ctx.http.get/post/put/delete/head/options/patch(url, options?)` | 返回 `Promise<Response>` |
| HTTP options | `headers`、`body`、`timeout`、`policy`、`policyDescriptor`、`redirect`、`credentials`、`insecureTls` | `timeout` 毫秒；Object body 自动 JSON 化 |
| Response | `status`、`headers`、`json()`、`text()`、`arrayBuffer()` 等 | body 只能消费一次，错误解析不能先 json 再 text |
| Header | `get/getAll/has/set/append/delete` | 大小写无关 |
| KV | `ctx.storage.get/set/getJSON/setJSON/delete` | 同步；get/getJSON 缺失为 null；set 字符串、setJSON 对象 |
| 通知 | `ctx.notify({title, subtitle?, body?, sound?, action?})` | action 支持 openUrl/clipboard；通知不能泄露凭据 |

HTTP 请求默认使用合法 TLS、`credentials: "omit"`，带鉴权或签名的请求使用 `redirect: "error"` 或显式验证同源的重定向规则。阿里云 RPC form body 必须传字符串，不能把对象交给自动 JSON 序列化。`policy` 可选，用户未指定时尊重现有网络配置，不擅自全局改路由。

完成方式：

- generic 返回 Widget DSL，根节点 `type: "widget"`。
- schedule/network 执行完 async 函数即可，无需返回 widget。
- request/response 脚本才使用请求/响应重写结构；本项目的主动 API 采集不需要它们。

**不要假设可用**：`$httpClient`、`$task`、`$persistentStore`、`$done`、`$widget`、`ListWidget`、DOM、Window、Node `require/fs/Buffer/process`、全局 `fetch`、`crypto.subtle/getRandomValues/randomUUID`、跨文件 import、输入弹窗、`ctx.source`、`ctx.confirm`。源码组织可以使用模块，发布 bundle 不能依赖未经确认的宿主全局或外部 imports。

### 3.2 模块、env 与定时字段

注册结构为 `scriptings: [{generic: {...}}, {schedule: {...}}]`，不是其他客户端的 `[Script]` 或 `cron` 顶层段。

- `script_url`：本地路径或远程脚本地址。
- 脚本 `timeout`：秒；默认 10，文档上限 600。上限不意味着 widget 实际一定有这么多执行时间。
- `update_interval`：远程脚本/模块代码更新周期，默认 86400 秒，**不是采集间隔**。
- `schedule.cron`：5 字段“分 时 日 月 周”或 6 字段“秒 分 时 日 月 周”。本项目默认 `*/15 * * * *`，表示每 15 分钟尝试采集。
- `disabled`：脚本禁用开关；自动控制模块默认禁用。
- `widgets[].name` 必填、唯一，`script_name` 关联 generic.name；同名时可省略。
- env 优先级为 **Module > Widget > Script**。模块级变量会覆盖所属所有脚本和 widget 的同名变量。
- `env_schema` 每项只有已确认的 `name/description/default_value/options`。`default_value` 仅是 UI placeholder，**不会自动写入 env**，运行时代码必须有相同默认值。
- `options: ["true", "false"]` 生成 Toggle，其他 options 生成 Picker，无 options 为 TextField；不要臆造 password、required、secure 等 UI 字段。
- 使用 `env` 传运行参数。`compat_arguments` 是 YAML 解析时的 `{{{KEY}}}` 纯文本替换，只处理模块已声明项，引号/反斜杠/换行能破坏 YAML；不用于大段 JSON 或秘密值注入。

widget 自身可用 `CDT_SCOPE_ID/CDT_INSTANCE_IDS/CDT_THEME` 等变量设置不同视图。需要多个视图时，不要在模块 env 里设置同名的 widget 选择变量，否则覆盖所有视图；测试覆盖此优先级。

同一个 Profile 安装多份模块时，`CDT_NAMESPACE` 只隔离业务 key，不能避免重复的 script/widget 名称。模块声明非秘密 `compat_arguments.MODULE_ID`，只允许 `[A-Za-z0-9_-]+`，把它用于 `generic.name/schedule.name/widgets.name/widgets.script_name` 的匹配前缀，例如 `cdt-{{{MODULE_ID}}}-widget`。Module env 不能用于 YAML 解析期的名称替换。默认一个 Profile 安装一份基础模块；需要多份时设置不同 MODULE_ID 与 CDT_NAMESPACE，实机验证合并后所有名称唯一。

### 3.3 原生 Widget DSL

支持 `systemSmall/systemMedium/systemLarge/systemExtraLarge/accessoryCircular/accessoryRectangular/accessoryInline`。

已确认节点：`widget/stack/text/image/spacer/date`；布局用 `children/direction/alignItems/padding/gap/flex`。不要生成未文档化的 `button/progress/canvas/onTap` 节点。

- `text`：`font.size` 可用语义名，`weight`、`textColor`、`maxLines`、`minScale`。
- Color：字符串颜色或 `{light, dark}` 自动适应主题。
- `image.src`：`sf-symbol:...`、Base64 raster data URI 或 SVG data URI；不能假设支持直接远程 HTTPS 图片。
- 图表/进度条采用嵌套 stack 或本地生成 SVG。SVG 必须有 xmlns 和 viewBox，源大小不超过官方 512 KB 上限；本项目应远小于该上限。
- `date` 节点 `date` 为 ISO8601，`format: "relative"` 可展示采样年龄，由系统更新文本。
- `widget.refreshAfter` 为未来的 **ISO8601 时间字符串**，不是秒数、cron 或刷新保证。
- `url` 点击只能打开深链接或网页；不得把点击的 GET URL 做成云端停机操作。

### 3.4 实机门槛和降级

官网没有确认下列行为；建立 `docs/compatibility.md` 记录 App/iOS 版本、验证步骤、实际结果和降级：

1. 不同 generic/schedule/script.name/module/profile 是否共享 storage；widget 扩展与主应用是否共享。
2. 多 widget 同时刷新时 storage 写入竞争、持久化时机、配置切换和 iCloud 同步。
3. 运行时语法版本及 TextEncoder、URL、URLSearchParams、btoa/atob、timer、crypto 和随机数能力。
4. cron 的时区、漏执行补跑、VPN 开关、App 后台/强退、锁屏、低电量、设备重启后的行为。
5. widget 的实际网络、执行预算、SVG、深浅色、字体与 refreshAfter 效果。
6. 手动 generic 的实际执行 UI、单次参数与确认能力；未确认前不能依赖快捷指令或脚本 URL Scheme。

**缓存默认降级**：若不能证明 schedule→widget 共享，每个 widget 自己做“读本上下文缓存→必要时只读采集→渲染”，schedule 负责它自己的采集/通知。不能让 widget 永久等一个它读不到的 key。不为解决缓存共享再引入强制服务器或外部存储。

**控制默认降级**：若不能证明一次性意图/消费标记可跨执行保存，并可靠串行或原子领取同目标意图，独立模式只提供监控、告警和云控制台链接；实例操作通过阿里云控制台或可选后端确认页面。持久化探针本身不证明互斥。这个条件阻断本地危险控制，不阻断独立监控交付。

## 4. 功能迁移矩阵

| 原功能 | 独立 Egern 模式 | 可选 Go 协作模式 |
| --- | --- | --- |
| 多账号/地域/实例 | 必须；拆开账户、流量范围、实例 | 读取 API DTO 并标准化 |
| 国内/海外 CDT 聚合 | 必须；按账号流量范围去重 | 兼容现有摘要；范围身份不明确时避免虚假总计 |
| 用户上限/百分比/阈值 | 必须；默认仅提示/告警 | 可由后端继续执行保护 |
| 状态/刷新 | 必须；刷新只读 | GET 快照；POST refresh 需要注意现有副作用 |
| KeepCharging/StopCharging | 独立控制增强项，显式意图与能力门槛 | 后端确认后调用；展示实际停止模式 |
| 自动阈值停机 | 默认关；手机端最佳努力、单独控制模块 | 推荐由常驻后端承担 |
| 每日定时启停 | 默认关；实际唤醒时判断时间窗 | 保留后端补偿与持久去重 |
| 保活 | 默认关；Stopped 时的有限重启，不是续租 | 后端持续监控 |
| 历史/日报 | 有限采样、明确实际覆盖和估算 | 复用历史/日报；修正口径缺陷 |
| 账单/余额 | 可选，默认关，6h TTL，CNY/USD 分开 | 读取已有缓存及错误 |
| 通知 | Egern 本地通知；可选 Telegram/HTTP Webhook | SMTP、SOCKS5、原完整 Outbox 由后端保留 |
| 登录、安装向导、Session、CSRF、Passkey | 不重建；使用 Egern env 配置 | 使用原控制台 |
| SQLite、持久 Job、调度租约、通知 Outbox | 不照搬；本地有限 KV，承认可靠性差异 | 保留后端实现，必要时修复 |
| 免费额度自动识别/价格预测 | 原项目没有；不作为必做迁移功能 | 未来增强，单独设计和标记 |
| 桌面/锁屏 widget | 新增的主要交付 | 同一渲染层支持两种 provider |

不把 SMTP 或真正的抢占续租隐藏在“稍后实现”的 TODO 中。文档明确说明宿主能力差异，并提供可工作的替代入口。

## 5. 目标架构和目录

逻辑链路：

```text
Egern env
    ↓
配置解析/校验 → 账户、CDT scope、实例映射
    ↓
Readonly Collector ── DirectAliyunProvider（默认）
    │              └─ CdtServerProvider（可选）
    ↓
规范化 Snapshot → 用量/阈值/历史纯函数 → 有限 KV cache
    ↓                                         ↓
Widget Renderer                         Schedule 采集/通知

显式控制意图 → Control Policy → 独立 Control Provider
                                 ↓
                         pending/accepted/uncertain
                         后续查询确认真实实例状态
```

推荐目录（除本指导文档外，以下文件均为后续实现目标）：

```text
egern/
  AGENTS.MD
  README.md
  package.json
  package-lock.json
  tsconfig.json
  src/
    entries/
      widget.ts                 # generic，只读，返回 DSL
      refresh.ts                # schedule，只读采集和允许的通知
      diagnostics.ts            # generic，只读诊断和合法 DSL
      control.ts                # 独立显式控制；能力门槛通过后实现
      automation.ts             # schedule，默认关，不与渲染共用入口
    host/
      egern.ts                  # ctx.http/storage/notify 适配
      types.ts                  # 只声明已经核实的 ctx 与 DSL 类型
    config/
      parse.ts
      validate.ts
    domain/
      models.ts
      usage.ts
      history.ts
      policy.ts
      schedule.ts
    providers/
      aliyun/
        rpc.ts
        signing.ts
        traffic.ts
        ecs.ts
        billing.ts
      cdt-server.ts
    services/
      collect.ts
      cache.ts
      notifications.ts
      control.ts
    widget/
      render.ts
      layouts.ts
      theme.ts
      svg.ts
    vendor/                     # 必要纯 JS 加密实现及许可证，按需
  modules/
    cdt-monitor.yaml            # 默认独立只读监控模板
    cdt-monitor-server.yaml     # 可选服务器只读模板
    cdt-monitor-control.yaml    # 可选控制模板，默认禁用控制
  examples/
    single-account.example.json
    multi-account.example.json
    multiple-widgets.example.yaml
  scripts/
    build.mjs
    validate-modules.mjs
    check-bundles.mjs
  tests/
    fixtures/                   # 云响应、服务器 DTO、固定时钟、无秘密
    host-fake.mjs
    signing.test.*
    traffic.test.*
    collection.test.*
    history.test.*
    policy.test.*
    widget.test.*
    module.test.*
  docs/
    compatibility.md
    aliyun-api-contract.md
    implementation-status.md
    acceptance.md
    migration.md
  dist/                         # 生成物，不手工维护
    cdt-widget.js
    cdt-refresh.js
    cdt-diagnostics.js
    cdt-control.js              # 仅在控制功能真实可交付时生成
    cdt-automation.js           # 同上
    cdt-monitor.yaml
    cdt-monitor-server.yaml
    cdt-monitor-control.yaml
    manifest.json
```

每个入口独立 bundle，共享逻辑只在源码中复用。widget 的依赖图不得包含 StartInstance/StopInstance 执行器；用静态依赖检查和 fake provider 验证这一边界。

不得让 domain 直接引用 ctx、HTTP、storage 或 Node。以接口注入 clock、http、storage、notify、signer/nonce，保证离线验证不需要真实云账户。

## 6. 配置与身份模型

### 6.1 单账号简单配置

基础模块至少提供：

| env | 默认/规则 | 用途 |
| --- | --- | --- |
| `CDT_MODE` | `direct`；服务器模板用 `server` | 数据源 |
| `CDT_NAMESPACE` | `default`；多份配置要求不同非秘密值 | 缓存/事件命名空间 |
| `CDT_ACCOUNT_ID` | `main` | 用户定义账户逻辑 ID，不是 AK |
| `CDT_ACCESS_KEY_ID` | 无默认 | direct 凭据 |
| `CDT_ACCESS_KEY_SECRET` | 无默认 | direct 凭据；不写公开 YAML |
| `CDT_SECURITY_TOKEN` | 空，可选 | 使用临时凭据时必须一并签名，过期后提示重新配置 |
| `CDT_SITE_TYPE` | `china` 或 `international` | BSS 端点/币种选择；不决定流量国内外分类 |
| `CDT_REGION_ID` | `cn-hongkong` | 单实例地域；用于默认 scope 分类 |
| `CDT_INSTANCE_ID` | 空 | 可只监控账号流量；控制必须精确实例 ID |
| `CDT_NAME` | `CDT` | 显示名称 |
| `CDT_QUOTA` | 无静默免费额度默认，必须用户确认 | 本周期用户配置的流量上限 |
| `CDT_QUOTA_UNIT` | 明确 `GB` 或 `GiB` | 上限单位；缺额度时显示未配置 |
| `CDT_THRESHOLD_PERCENT` | `95`，合法范围 `(0,100]` | 告警百分比 |
| `CDT_TRAFFIC_CLASS` | 按地域推导或显式 mainland/overseas | CDT 聚合范围 |
| `CDT_REFRESH_SECONDS` | `900` | 本地缓存 TTL/refreshAfter 意图；不是 cron |
| `CDT_BILLING_ENABLED` | `false` | 余额/账单 |
| `CDT_LOCAL_NOTIFY` | `false` | schedule 本地阈值通知；widget 不发告警 |
| `CDT_TIMEZONE` | `Asia/Shanghai` | 业务显示/日报时区；云计费周期时区独立核实 |
| `CDT_DEBUG` | `false` | 仅脱敏诊断 |
| `CDT_BASE_URL` | 无默认 | server 数据源 HTTPS 基础地址 |
| `CDT_READ_TOKEN` | 无默认 | server 的 widget:read Key |
| `CDT_ACCOUNTS_JSON` | 空 | 高级多账号模型；配置后与简单模式互斥 |

render-only 视图变量 `CDT_SCOPE_ID/CDT_INSTANCE_IDS/CDT_THEME` 由 widget.env 提供，不作为控制对象选择器。颜色选择只接受已定义主题，不能从 env 执行任意代码。

默认未填写 QUOTA 时，仍可显示真实用量与状态，剩余/百分比/阈值显示 `—/未配置`；禁止用零、NaN 或默认 200 假装免费额度。可以在配置帮助中说明常见海外 200GB 权益，但必须让用户确认自己的计费条件和单位。

高级 JSON 必须有 schemaVersion，错误直接显示具体字段，不擅自回退到另一套账号配置。设置 `CDT_ACCOUNTS_JSON` 时 simple 凭据字段不能同时产生重复账号。

### 6.2 高级规范化模型

示意数据使用假值；此结构是本项目自己的业务配置，不是 Egern 原生 schema：

```json
{
  "schemaVersion": 1,
  "namespace": "personal",
  "credentials": [
    {
      "id": "cred-main",
      "accountId": "account-main",
      "accessKeyId": "EXAMPLE_AK_ID",
      "accessKeySecret": "EXAMPLE_SECRET",
      "siteType": "international"
    }
  ],
  "accounts": [
    { "id": "account-main", "name": "阿里云主账号", "aliyunUid": null }
  ],
  "trafficScopes": [
    {
      "id": "main-overseas",
      "accountId": "account-main",
      "credentialId": "cred-main",
      "trafficClass": "overseas",
      "quota": { "value": 200, "unit": "GB", "source": "user" },
      "thresholdPercent": 95,
      "controlTargets": []
    }
  ],
  "instances": [
    {
      "id": "hk-ecs",
      "accountId": "account-main",
      "credentialId": "cred-main",
      "trafficScopeId": "main-overseas",
      "regionId": "cn-hongkong",
      "instanceId": "i-example",
      "name": "香港实例",
      "keepAlive": false,
      "shutdownMode": "KeepCharging",
      "schedule": { "enabled": false, "start": "08:00", "stop": "23:30" }
    }
  ]
}
```

模型职责：

- **Account**：阿里云真实账户。不同 AK 可能属于同一个账户，不能按 AK 数量自动视为不同免费额度。
- **Credential**：认证材料，允许轮换。敏感字段只在配置解析后提供给 provider，不能出现在业务快照或 widget。
- **TrafficScope**：账户 + mainland/overseas + 经核实的统计维度；拥有一次额度和累计值。
- **Instance**：地域 + 精确 ECS InstanceId；状态和实例费用独立。
- **ControlPolicy**：显式目标白名单、动作模式、时间窗；与视图选择隔离。

同账户的多个 AK 应由用户配置到同 accountId，或者通过已验证的 UID 查询建立关系。UID 不明时不做“所有账号总剩余额度”这样的强汇总；提示需确认账户分组。相同 scope 多实例不重复加用量/额度/余额；实例账单按实例身份去重。

修改 credential/account/scope/region/instance 身份时，相关运行数据、账单、控制事件和历史绑定必须失效或重新关联，不能复用旧 AK Secret 或旧实例状态。单纯改备注和布局不清空历史。

配置校验：ID 唯一、引用存在、地域非空、数值有限、配额正数、开关严格解析、合法 siteType/mode、HTTPS 服务地址、时间 HH:mm、时区可用。开始等于停止默认拒绝；若以后支持 24h 窗口须显式字段。非法控制配置不影响其他合法账户的只读展示，但必须显示错误且禁用其控制。

### 6.3 通知、日报和控制的高级配置

高级配置也必须落成文档化、可验证的 JSON schema，不用大量互相矛盾的 env 开关拼凑多账号策略：

- `CDT_NOTIFICATION_JSON`：包含各渠道 enabled（默认false）、Telegram/Webhook必需字段、日报 enabled（默认false）、HH:mm、固定报告窗口、漏执行补偿窗。秘密仍只来自本地 env，此值不得进快照。`CDT_LOCAL_NOTIFY` 简单模式只控制本地阈值通知，不自动开启日报。
- `CDT_CONTROL_JSON`：包含 `schemaVersion`、独立控制凭据引用、`enabled:false`、明确实例白名单、各scope的thresholdAction（默认notify_only）、thresholdStopEnabled（默认false）、各实例scheduleControlEnabled/keepAlive（默认false）、shutdownMode（默认KeepCharging）、actionCooldownSeconds、pauseUntil。只被control/automation入口读取，widget/refresh忽略这些执行配置。
- `CDT_CONTROL_INTENT_JSON`：本地单次人工意图，字段见10.2；没有合法意图时control generic无写操作。人工override单独标记并限时，不能隐含在视图选择变量中。
- 控制凭据与simple监控凭据分开。存在多个credentialId时，在CONTROL_JSON显式选择用于执行的credentialId并验证所属账户；绝不从“当前显示的第一个实例”推导目标。

示例必须覆盖单账号、多账号、同scope多个控制目标和全部开关关闭；schema的字段说明给出单位/默认值/继承顺序。notify_only告警可由refresh处理，stop_and_notify产生的动作及其结果通知只能由automation/control处理，共用纯通知发送器但不共用云写执行器。未知字段默认拒绝或给明确警告，不能忽略配置错误后执行控制。

## 7. 阿里云 API、签名与权限

### 7.1 当前代码 API 表

以下来自 [client.go](<../internal/aliyun/client.go>)，是迁移起点，不表示全部接口都有公开可查询的官方契约：

| 服务/动作 | Version | endpoint / RegionId | 参数与解析 |
| --- | --- | --- | --- |
| CDT `ListCdtInternetTraffic` | `2021-08-13` | `cdt.aliyuncs.com` / `cn-hongkong` | 源码无显式统计周期参数；解析 TrafficDetails.BusinessRegionId/Traffic |
| ECS `DescribeInstanceStatus` | `2014-05-26` | `ecs.<region>.aliyuncs.com` / 实例 region | 源码传 InstanceId；目标须核对实际参数索引/过滤并精确匹配返回实例 |
| ECS `StartInstance` | 同上 | 同上 | RegionId、InstanceId |
| ECS `StopInstance` | 同上 | 同上 | RegionId、InstanceId、StoppedMode |
| BSS `QueryAccountBalance` | `2017-12-14` | china: `business.aliyuncs.com` / `cn-hangzhou`；international: `business.ap-southeast-1.aliyuncs.com` / `ap-southeast-1` | Data.AvailableAmount、Currency |
| BSS `DescribeInstanceBill` | 同上 | 同上 | BillingCycle=YYYY-MM、InstanceID、Granularity=MONTHLY；Items 或 Items.Item 的 PretaxAmount 求和 |

核对分页、响应包装、业务 Code 和精确实例筛选。ECS 查询不能取返回的第一个实例就当目标实例。BSS 如果分页要取全，不能把第一页称为完整账单。

本次下载的公开 CDT Go SDK `cdt-20210813` 未包含 `ListCdtInternetTraffic` 定义，因此该接口的统计周期、计量单位、RAM Action、分页/有效空数组、延迟及稳定性必须在 `docs/aliyun-api-contract.md` 单列待核实项。不能自己添加 StartTime/EndTime 参数，不能宣称官方 SDK 已保证支持，也不能因文档不全直接忽略源项目已使用的接口。

优先用脱敏真实响应、源项目测试和用户授权的只读联调确认。如果该接口当前不可用，明确错误和已验证的替代路径；可用 server provider 展示现有数据，但不得悄悄声称 direct 模式验证成功。禁止以抓取网页登录 Cookie 作为默认实现。

### 7.2 RPC 签名

源码采用传统 RPC V2 请求格式、`SignatureVersion=1.0`、HMAC-SHA1。官方当前页面将 V2 标为已停用/不推荐，建议 V3：

- [传统 RPC 签名说明和固定向量](https://www.alibabacloud.com/help/en/sdk/product-overview/rpc-mechanism)
- [V3 请求及签名](https://www.alibabacloud.com/help/en/sdk/product-overview/v3-request-structure-and-signature)

实施顺序：先用固定向量建立与源项目一致的传统签名兼容层，再在单独的签名策略中核实目标服务接受的算法。不能把 V2 宣传成推荐新标准；也不能未经验证全量切 V3，尤其不能假设内部 CDT 动作支持。最终记录各 API 实际采用的签名版本与依据。

传统签名必须：

1. 合并公共与业务参数，排除 Signature，按键名 ASCII 顺序排序。
2. 对键和值进行 UTF-8/RFC3986 percent encode；空格 `%20`、星号 `%2A`、`~` 保留。JS `encodeURIComponent` 还要正确处理 `!'()*`。
3. 拼 `CanonicalizedQueryString`，再构造 `POST&%2F&percentEncode(canonical)`；方法必须与真正 HTTP 方法一致。
4. key 为 `AccessKeySecret + "&"`，HMAC-SHA1 取二进制 digest，再 Base64，最后表单编码。
5. Timestamp 用 UTC `YYYY-MM-DDTHH:mm:ssZ`；每次请求/重试重新生成 nonce、时间戳和签名。
6. 临时凭据包含 SecurityToken；缺 token 或过期不静默降级为其他账户。
7. 使用 `application/x-www-form-urlencoded` 字符串 POST 至 HTTPS 根路径。

离线固定向量：官方示例 method=GET、Action=DescribeDedicatedHosts、AccessKeyId=testid、secret=testsecret、RegionId=cn-beijing、Version=2014-05-26、Format=JSON、SignatureMethod=HMAC-SHA1、SignatureVersion=1.0、Timestamp=2023-03-13T08:34:30Z、SignatureNonce=edb2b34af0af9a6d14deaf7c1a5315eb，期望 Base64 Signature：`9NaGiOspFP5UPcwX8Iwt2YJXXuk=`。另增加 POST、中文、空格、`+/~!*'()`、嵌套百分号和 secret 含特殊字符的对拍。

不要把完整阿里云 Node SDK 塞入 bundle；它通常依赖 Node 内建。采用经许可、轻量、纯 JS 加密实现或通过实机验证的宿主 crypto，补齐其 UTF-8/Base64 所需功能和许可证。不得使用 Node 的测试成功来证明 Egern 有 Buffer/crypto。

nonce 工厂可注入便于测试。生产需核实可用的随机/唯一性来源；单独 `Date.now()` 或每次固定值不能满足并发重试唯一性。官网没有保证安全随机数，能力未确认时必须记录实现条件，不能静默写 `Math.random()` 后称其为加密安全随机数。无法支持可靠签名的设备提供明确不支持提示与 server 模式。

### 7.3 数据解析和错误

- CDT 兼容源码已出现的根 TrafficDetails 与 Data.TrafficDetails、数组/Item 包装；未知结构不能归零。
- 原源码把空 TrafficDetails 当错误并重试；目标必须区分“缺字段/异常响应”与“已确认有效的空列表=0”。在契约未确认前显示未知/上次数据，而不是错误触发额度恢复。
- 数字字符串需严格解析；非数字、负字节、超出安全精度、缺 BusinessRegionId 均有确定行为。不得 `parseFloat("123bad")` 接受非法数值。
- HTTP 2xx 不一定业务成功；Code=OK/200/Success 等已证实值成功，其他依服务规则处理。
- 401/403、密钥/权限/参数错误不循环重试；429/部分5xx/网络错误按预算有限重试；时间戳错误重建请求，持续偏差提示校准时间。
- read 请求默认最多 2 次尝试，总时间预算优先。超时的启停请求标 uncertain，不直接按读请求策略重放。
- 外部 body 最大大小、JSON 深度和日志长度需有边界；不输出原始含秘密的请求、签名、URL 或异常对象。

### 7.4 最小权限

提供经过 API/RAM 契约核对的权限说明，区分：

- 只读监控：CDT 查询与目标 ECS 查询。
- 可选账单：BSS 余额与实例账单查询。
- 控制：仅显式实例的 StartInstance/StopInstance；必要 DescribeInstances 用于模式/状态核验。

不要求 AdministratorAccess、ECS 全权限或任意资源删除权限。CDT/BSS 是否必须 Resource=`*` 按官方授权粒度记录，不能编造资源 ARN 或 RAM action。

真实用户 AK/Secret、server token、通知 token 只从用户本地 env 提供，不写源文件、公开模块、发布 JSON、截图、fixture 或安装链接。env/storage 是否有 Keychain 级保护未获官方承诺；准确说明配置备份/同步/分享可能包含敏感内容，不以存储 key 改名或脚本内置 AES key 冒充安全保管。

## 8. 计量、账单与快照口径

### 8.1 必须修正的范围和单位

源 `GetTraffic` 以 AK + china/international 分类缓存；`trafficFromResponse` 聚合 BusinessRegionId，`cn-*` 且非 `cn-hongkong` 为国内，其他为海外，最终除 `1024^3`，界面却标 GB。

目标要求：

- 账户 CDT 流量是账户范围，**不是单台 ECS 流量**，也不是 Egern 本机代理统计。
- UI 标注“账号海外 CDT”或“账号国内 CDT”；实例仅关联该范围。若真实响应提供更多维度，核实后单独扩展。
- provider 优先保存原始 bytes；GB=`10^9 bytes`，GiB=`2^30 bytes`。比较阈值前把配额统一转换成 bytes；显示转换放最后。
- 从 Go API 导入 flow_used/used 时，按现有行为视作 GiB，转换并记录 `sourceUnit: "legacyGiB"`；不能把数字原样改标签为 GB。
- 给旧 MaxTraffic 的迁移提供明确 `legacyGiB` 选择；若用户想按官方权益 GB 重新定义，显式重新配置，不能无提示改变停机边界。
- 国内/海外类别与 `siteType` 中国站/国际站是独立概念；香港一律属于海外分类，不受账户站点影响。

[阿里云 CDT 计价](https://www.alibabacloud.com/help/en/cdt/internet-data-transfers/) 当前说明 BGP 按流量计费条件下账号共享国内20GB、海外200GB，合计220GB，月初重置且只有出网流量抵扣；BGP Pro、按带宽、资源包等有不同条件。**这不是“每个实例200GB”，也不代表接口所有 Traffic 都一定是已扣免费额度后的用量。**免费权益和配置上限分字段，不把本项目 QUOTA 默认当厂商权益。

### 8.2 快照数据结构

规范化快照至少包括：

```text
Snapshot
  schemaVersion, namespace, configFingerprint, provider, generatedAt
  accounts[]: id, name, balance?, currency?, balanceObservedAt?, balanceError?
  trafficScopes[]:
    id, accountId, trafficClass, sourceScope, periodId, periodTimezone
    usedBytes?, quotaBytes?, quotaSource, sourceUnit
    trafficObservedAt?, trafficAttemptedAt?, trafficError?, stale
    remainingBytes?, usagePercent?, overThreshold?, thresholdPercent
  instances[]:
    id, accountId, trafficScopeId, regionId, instanceId, name
    status, statusObservedAt?, statusError?
    monthlyCost?, currency?, billingCycle?, billingObservedAt?, billingError?
    lastAction?, actionRequestedAt?, actionState?
  errors[]: sanitizedCode, entityId, userMessage
```

所有 observedAt 只在相应 API 成功确认后更新。`generatedAt`、UI 渲染、控制受理或部分 API 成功不能把所有字段标成新鲜。

- 缺数据用 null/缺字段，合法0保留为0。Unknown 状态不同于 Stopped。
- 总用量按独立 scope 只加一次；余额按 account 只加一次；币种分组，不自动换汇。
- 实例账单是实账缓存，不能称 CDT 专项费用、总云费用或流量估算。
- 周期 ID 和 timezone 由数据源契约决定；本地手机月初到来不等于云端累计已重置。期间不明确时显示“接口累计/周期待确认”。

### 8.3 百分比、剩余与阈值

`remainingBytes=max(0, quotaBytes-usedBytes)`；`usagePercent=usedBytes/quotaBytes*100`；显示可四舍五入，**决策比较原始值**。超过100%时文字显示真实百分比，图形绘制 clamp 到 `[0,1]`。

配额缺失/不正数/单位不明确，百分比和 overThreshold 为 unknown，禁止自动控制。threshold=95、同一单位上限200时，190触发、189.98不触发；不能因为94.995显示95.00就提前动作。

month forecast、耗尽日、超额价格不是必做迁移功能。如新增，单独标估算，记录有效样本、覆盖区间、假设与定价版本；不拿一次累计数假装实时速率。

### 8.4 历史与日报

源小时/日表存的是**接口累计值采样**，原UI/日报按月解释，但当前provider没有显式周期参数，不能仅从存储逻辑证明它始终是当月累计。同桶覆盖最新值，桶起点不是实际采样时刻。目标保留 observedAt、periodId、bytes、source、quality；已核实周期后才按同周期差分和跨周期分段计算。周期未核实时用unknown period标记，显示“接口累计”，不按本地月份擅自分段或重置。

工程默认：每 scope 最多保存48个小时样本、35个日样本；实际采样不足保留空缺。同一桶只保留最新成功样本，但额外保留真实 observedAt。预算超出按旧数据清理，不存完整云响应。

- 累计曲线可直接展示；已核实月周期才标“本月累计”，否则标“接口累计”。小时消耗必须差分并标真实间隔，周期未核实的数据不得标精确小时消耗。
- 只采到2小时数据，就显示“最近2小时，估算”；没有基线显示暂无历史，不能拿0当24h基线。
- 已核实月周期的样本跨月按 period 分段计算，旧月尾缺失标 partial，不能把旧月100→新月2简单算成0或2并称24h精确值；未核实周期时仅记录累计下降及质量说明，不推断月重置。
- 同周期累计降低视为数据修订/异常，记录 quality，不自动当月重置，不解除保护闩锁。
- 定时日报以固定 start/stop 采样与周期为准；跨午夜归启动日，任务延期重试不换统计窗口。
- 日报按 scope 报用量、按实例报状态/费用。没有真正实例流量接口时不能写“每台实例精确消耗”。
- Egern 本地日报按脚本执行机会最佳努力推送，事件键绑定账号范围/报告窗口/渠道；超出允许补偿窗不补发几十天历史日报。

### 8.5 账单

默认禁用账单；启用后余额、实例账单各自6h TTL。核心 CDT/ECS 采集优先，剩余预算不足时账单留待下一次。

当前月份统一用已配置业务/计费时区确定，不能采集用UTC、显示用手机当前时区。失败保留上次成功值与实际时间，展示陈旧标记；0金额不能显示成缺数据。CNY/USD 分开合计。

## 9. 缓存、并发与执行预算

### 9.1 缓存键与持久化

推荐键前缀：`cdt:egern:v1:<namespace>:<provider>:<entityId>:<kind>`，kind 为 snapshot/history/alert/action-intent 等。不把 Secret、Token 或完整 AK 填入 key。

key 只是工程命名，不代表 Egern 有隔离保证。相同账号 namespace 下的多实例共用 scope 数据；不同 module/profile 的身份和配置 fingerprint 必须验证，防止旧缓存串号。

`ctx.storage` 没有文档化事务、CAS、TTL、锁或枚举。读取时校验 schemaVersion、身份、时间、有限数值；损坏缓存保留为诊断证据或忽略并重采，不导致空白 widget。升级采用读旧→规范化→写新、有限版本支持；不自动清空所有用户配置。

单个实体快照以一个 JSON 值提交，不宣称全账户事务。缓存无秘密，默认总缓存预算约256KB；超过时优先清历史/事件，保留最近快照。存储容量是本项目预算，不是 Egern 已知平台限制。

### 9.2 并发与失败隔离

- 单次执行内同 credential 的 CDT 请求合并；一次完整 TrafficDetails 能服务国内/海外 scopes，避免逐实例重复查。
- 默认网络并发上限2，账户数较多时轮换采集过期实体，不让最后账号永远饿死。
- 同实例动作单次执行内串行；不声称全局 Mutex 能跨多个 Egern 执行上下文工作。
- 只读并发冲突保留各实体最新 observedAt，能合并时合并。无原子保证时，不用“先检查再写 flag”宣称 exactly-once。
- 跨执行同目标控制无法可靠互斥或claim时，禁用本地人工与自动控制并导航控制台/后端；只读采集和通知显示其去重限制。
- 某账号失败不清空其他账号；某字段失败不覆盖成功字段。widget 在任何异常下返回合法且有说明的 DSL。

### 9.3 项目默认预算

这是可调整的工程目标，须实机确认：

| 场景 | 默认值 |
| --- | --- |
| widget 脚本 timeout | 20s，内部任务预算约15s，保留渲染时间 |
| schedule timeout | 30s，内部预算约25s |
| 单次HTTP timeout | 约6–8s，受剩余总预算约束 |
| 基础数据TTL | 15min；靠近阈值可请求5min意图，但不承诺唤醒 |
| billing TTL | 6h |
| read 请求尝试 | 最多2次，总预算不足不重试 |
| 网络并发 | 2 |
| 单 bundle 体积目标 | 优先低于200KB；不是平台硬限制 |

`refreshAfter` 只能请求未来刷新；iOS WidgetKit 的动态预算和系统状态决定实际时间。不要把 cron 15min、refreshAfter15min、脚本文件 update_interval 混为一谈。API流量本身也可能延迟，阈值告警/停机不能保证绝对零超额费用。

## 10. 控制、保护、计划与保活

### 10.1 读写分离硬边界

**widget、diagnostics、普通 refresh、history、report data collection 均不调用 StartInstance/StopInstance，也不通过旧后端 refresh 间接控制。**schedule 监控可发送用户已启用的阈值/日报通知，但控制只允许独立 automation 入口。

generic 文档同时支持手动和 widget 自动执行。`ctx.widgetFamily === undefined` 不能证明“用户点击并确认了控制”，模块级 `MODE/ACTION/ALLOW_CONTROL` 也不能令 read 入口变为写入口。

### 10.2 手动控制路径

优先提供安全且真实可工作的入口：widget.url 打开阿里云控制台或现有 Go Web 控制台，由页面确认后执行。URL 中不包含密钥和执行动作，GET 只展示。

若实现独立本地 action generic，必须满足：

1. 单独 script 文件，未关联任何 widget、network 或 schedule，read bundle 不引用它。
2. 单独配置控制权限和实例目标，默认 `CDT_CONTROL_JSON.enabled=false`，没有该配置等同关闭；不另设与其冲突的隐式开关。
3. 用户本地明确创建一次性 `ControlIntent`，含具体account/region/instance/action/stoppedMode、issuedAt、expiresAt、唯一nonce；不能把长期固定 `ACTION=stop` 当每次执行授权。
4. 验证账户/实例白名单、非 widget context、意图未过期未消费；**非 widget 只是额外检查，不是授权本身**。
5. 实机证明意图消费状态可跨执行保存，并且同目标手动运行已获宿主串行保证、可靠原子claim或服务端幂等之一；仅get后set与本地幂等key不能防并发重复消费。消费标记先持久化，崩溃/超时变uncertain，后续查状态，不盲重发。互斥前提不成立时人工本地动作也按3.4降级，不能只禁用自动化。
6. UI 如有真实已核实确认能力可使用；否则给出用户手动创建/检查该意图再运行的步骤，不能调用幻想的 ctx.confirm 或 scripts/run 协议。
7. 如果这些前提不成立，不发布声称可安全启停的本地按钮，按3.4降级。

### 10.3 自动化与策略顺序

单独 control 模块/automation schedule 默认disabled，并且代码默认三个开关均false：threshold stop、schedule control、keepAlive。启用必须指明范围、实例白名单、动作、停机模式和可靠性限制。

策略为可测试纯函数 `evaluate(snapshot, config, now) -> decisions[]`。执行器再次验证最新状态和许可。

优先顺序：

1. 配置/授权/身份/新鲜度不确定：不启动，不执行不明确目标的操作，显示阻断原因。
2. 新鲜数据确认超阈值：禁止自动定时启动和保活；按显式保护模式考虑停机。
3. 定时停止和人工停止意图优先于保活；人工stop可设置pauseUntil/暂停保活，避免刚停又起。
4. 过渡状态 Starting/Stopping/Pending 不重复控制；Unknown 先查询。
5. 未超阈值且在合法计划窗口，才允许显式计划启动/保活。
6. 人工越过保护启动如有需求，必须另有一次性、限时override，默认拒绝。

“告警去重”和“维持停止保护”分开建事件状态。源代码 `threshold:<id>:active` 把两者绑定，第一次超限后重新开机可能不再停机；目标不能照搬。通知可一次，但每次合法新观察到超限且运行中，执行器仍应根据当前保护状态判断，受动作冷却/待确认限制。

### 10.4 停机模式与动作状态

默认 KeepCharging。StopCharging 为显式选择的经济停止；依据 [阿里云经济停止说明](https://www.alibabacloud.com/help/en/ecs/user-guide/economical-mode)：可能释放计算资源和系统公网IP，重启依赖库存；云盘、EIP等费用可能继续。不满足条件时API可能仍成功按普通方式停机，因此“请求StopCharging”不等于“已进入经济停止”。如展示结果模式，使用已核实 DescribeInstances 字段确认。

动作状态至少：`pending → accepted → confirmed`，异常为 `uncertain/failed`。云端API受理成功先展示“已发送/启动中/停止中”，待查询才显示最终Running/Stopped。ActionAt不更新流量采样时间。

幂等键含 namespace、账户、精确实例、动作、意图/计划周期、配置版本；nonce不同不代表同一目标可以并行冲突。超时先查状态，再按已验证云端幂等机制决定重试。不能声称本地KV提供事务或强一致 exactly-once。

### 10.5 计划与保活

计划基于合法 HH:mm 和明确业务时区。支持跨午夜，例如08:00→次日00:34归启动日；保留源项目计划后10min的短补偿语义，超过窗口不突然补停/补开。暂停几天后不追赶所有旧任务。

Egern cron 时区未文档化，不直接把cron的某小时当业务时区：用周期触发器运行，再在代码中按配置时区判断due window。独立automation建议使用 `*/5 * * * *`（每5分钟尝试），不能复用基础采集的15分钟周期来承诺覆盖10分钟补偿窗；仍不保证系统按时唤醒。日报时刻也按业务时区判断，基础15分钟refresh的日报补偿窗至少覆盖一次正常触发（工程默认20分钟），与启停的10分钟窗分别配置。运行时缺可靠时区支持时只支持经证实的默认时区或禁用本地计划，不硬猜DST偏移。

保活仅对明确Stopped的现存实例有限重试StartInstance。自动保护优先，停止窗口外不启动；释放/回收/找不到实例只能报警，不能购买或重建。不得称为延长Spot租期或保证抢占不回收。

## 11. 通知

默认插件无外发测试副作用。schedule 通知由用户明确启用：

- Egern 本地通知为基本渠道；阈值按scope去重，日报固定报告窗口。
- 可选Telegram/HTTP Webhook，复用源模板语义前先定义字段；新模板不把MAX_TRAFFIC误当阈值百分比。
- SMTP、自定义SOCKS5及原Outbox强恢复留在可选后端，不假设ctx有原始TCP能力。
- 通知事件使用稳定 eventId + channel；一次执行中失败有限重试，下次执行可恢复有限待发队列，不无限增长。
- HTTP状态和服务业务结果都需检查；Telegram的ok=false、DingTalk errcode 非0不能按HTTP200算成功。
- URL、Authorization、自定义headers、BotToken等必须脱敏；不要缓存整份敏感通知配置。
- JSON模板通过结构化JSON序列化或明确安全替换生成；覆盖引号、反斜杠、Unicode、换行和FORM编码。
- 通知点击只导航，不能暗藏停机URL；不要在锁屏显示账户余额/完整实例ID等隐私，除非用户显式允许。

通知权限被拒或渠道失败不妨碍用量展示。测试通知仅在明确手动入口、用户指定目标且有授权时发送，默认离线测试指向fake transport。

## 12. 可选 Go 后端协作

### 12.1 复用实际接口

实际路由依据 [server.go](<../internal/httpapi/server.go>)，不是旧架构建议中的未实现路由：

| 接口 | scope | 行为 |
| --- | --- | --- |
| `GET /api/v1/widget/summary` | `widget:read` | 紧凑DTO |
| `GET /api/v1/status` | `widget:read` | 完整账户摘要 |
| `GET /api/v1/accounts/{id}/history` | `widget:read` | `{hourly,daily}` 累计样本 |
| `GET /api/v1/jobs/{id}` | `widget:read` | 读取job状态 |
| `POST /api/v1/accounts/{id}/refresh` | `instance:control` | 202作业；当前可能执行自动策略 |
| `POST /api/v1/accounts/refresh` | `instance:control` | 批量刷新作业 |
| `POST /api/v1/accounts/{id}/actions/start|stop` | `instance:control` | 202，不是最终动作完成 |
| `PATCH /api/v1/accounts/{id}/settings` | `admin` | 不应让普通widget取得admin |

鉴权首选 Authorization: Bearer，Token不放URL。只读渲染使用 `CDT_READ_TOKEN`，控制独立凭据，不能让组件安装要求instance:control/admin。

紧凑摘要真实形态：

```json
{
  "accounts": [
    {
      "id": 1,
      "name": "香港实例",
      "status": "Running",
      "used": 12.5,
      "total": 200,
      "percentage": 6.25,
      "updated_at": "2026-10-05T08:00:00Z"
    }
  ],
  "updated_at": "2026-10-05T08:00:00Z"
}
```

紧凑摘要没有threshold/stale/region/balance/monthly_cost。完整status的 `{accounts,system_last_run}` 才有flow_used/flow_total/last_updated/stale等。需要额外信息时选择status或新版补充接口，不编造紧凑字段。

**v1新鲜度限制**：顶层更新时间来自监控入队，行级updated_at/last_updated也共用Account.UpdatedAt。手动/定时动作会更新它而没有重新观测流量，状态查询失败也可能随成功流量查询更新这一时间。CdtServerProvider保存为 `legacyUpdatedAt` 并标 `freshnessQuality:"legacy-unverified"`；trafficObservedAt/statusObservedAt保持未知，不能把GET响应时间或该字段当作云数据真实采样时间。UI可以显示“服务器记录更新于…”并明确可能有陈旧字段；v1数据不得作为本地自动控制的新鲜度证明。field-level freshness的严格要求适用于direct有效采样和新增v2字段，v1兼容通过明确质量标签降级。

服务器地址校验 scheme、host、无userinfo/query/fragment，保留反代基础路径。正式默认HTTPS；本机调试HTTP需显式开发选项。远程HTTP401/403分别提示Token失效/缺scope，保留旧数据并标错误；403不自动改为admin登录。

### 12.2 兼容性及后端修改

现有摘要按配置行而不是账户scope，无法仅从masked AK可靠判断两条记录是否同一账号。server模式可逐行展示但不重复累加未知范围；高级配置可给显式分组。若增加backend widget v2，新增可兼容字段或新版本接口，包括accountUid/scopeId/unit/period/trafficObservedAt/statusObservedAt，保留v1与Android/Web客户端。

强制只读刷新需要新增明确只读collect job/接口，而非直接复用 `processAccount(force=true)`。未增加前widget只GET快照，显示由后端采集，不调用POST refresh。旧refresh语义不能无提示改变，避免其他客户端兼容问题。

控制job以queued/running/completed/failed展示；202不等于实例已经Running/Stopped。短预算内有限轮询，未完成则下次执行继续，不长时间阻塞widget。现有动作scope可能影响所有配置实例，没有账户级Token限制保证；不要宣传它比实际更细粒度，必要时增补实例白名单鉴权。

要求完整可靠自动化时修复：保护优先级、告警/动作闩锁分离、每字段observedAt、共享scope去重、周期固定、uncertain动作查询、跨进程对象串行、快速重启作业回收。不要重写整个Go服务；只在启用该模式需要的范围增量修复并补有价值回归测试。

## 13. 小组件信息架构

使用系统语义字体、SF Symbols、本地SVG和adaptive colors。视觉方向是紧凑、清晰的监控卡片。通用网页技能的营销页、外部Google字体、hover、GSAP不适用于Egern DSL；不将它们引入组件。

| Family | 必须信息 | 可选信息 |
| --- | --- | --- |
| systemSmall | 单scope名称、用量/上限、百分比、状态/阈值提示、采样年龄 | 小进度条 |
| systemMedium | 一个scope用量和阈值、关联实例摘要、时间/陈旧提示 | 余额/费用一项或小趋势 |
| systemLarge | 多scope去重列表、实例状态、清晰异常、时间 | 最近24h/30d累计或有效增量SVG |
| systemExtraLarge | 大布局自适应 | 多列，不能依赖固定iPhone尺寸 |
| accessoryCircular | 百分比/简短状态与可辨识的超限提示 | 小环图；隐藏隐私字段 |
| accessoryRectangular | 名称、剩余/用量、陈旧/状态简写 | 紧凑更新时间 |
| accessoryInline | 单行，例如`CDT 83% · 运行` | 无图；错误缩写 |

多实例共享范围时把用量画在scope行，实例行只列状态，不把同一用量画成多份独立可相加额度。

所有布局覆盖：未配置、首次等待、正常、接近阈值、已超阈值、过渡状态、断网旧缓存、凭据失效、权限不足、无历史、部分成功、账单失败、选中对象已删除。

显示规则：

- 优先名称→用量/额度→保护/实例状态→真实采样年龄；在小尺寸移除次要账单，保持核心信息。
- 不以绿点/红点作为唯一状态；有“运行/停止/未知/超限/旧数据”文字。
- 正常文字在浅/深色背景保持足够对比，目标4.5:1；字号优先headline/body/caption1，适度maxLines/minScale，不缩到不可读。
- 锁屏按其视觉限制单独适配，不能照搬带大背景的桌面布局。
- 图表无数据显示说明，SVG颜色与当前主题一致；转义名称，禁止把用户文本插成可执行SVG片段。
- url 默认打开安全的详情/设置页面或已核实Egern路径。官方 `egern:/modules/new?name=...&url=...` 可用于安装模块，参数必须URL编码；没有文档化scripts/run。
- 不添加虚假“实时刷新”“精确保护中”标签。`date.relative` 显示最近成功采样年龄。
- 未知family或手动运行无family时返回systemMedium的简化合法DSL，不抛异常。

实机检查系统大字体、深浅色、长中文/英文名称、7个families。未验证设备/iPad尺寸记录为未验证，不伪造截图。

## 14. 模块配置模板

下面是**待实现的有效字段结构示意**，URL为明确占位。真正发布时由构建配置生成匹配tag/commit的地址，不把example.com当可安装产物。

```yaml
name: "CDT Monitor"
description: "阿里云 CDT 用量与 ECS 状态，只读小组件"
icon: "chart.bar.fill"
compat_arguments:
  MODULE_ID: "main"
compat_arguments_desc: "同一 Profile 安装多份时设置不同的非秘密 MODULE_ID；仅字母、数字、下划线和连字符"
env_schema:
  CDT_ACCESS_KEY_ID:
    name: "AccessKey ID"
    description: "本地填写，只读 RAM 凭据；分享配置前移除"
  CDT_ACCESS_KEY_SECRET:
    name: "AccessKey Secret"
    description: "仅保存在你的 Egern 配置中，不填进脚本源码"
  CDT_REGION_ID:
    name: "实例地域"
    default_value: "cn-hongkong"
  CDT_INSTANCE_ID:
    name: "实例 ID（可选）"
  CDT_QUOTA:
    name: "本周期上限"
    description: "用户确认的额度，未配置时只显示用量"
  CDT_QUOTA_UNIT:
    name: "上限单位"
    default_value: "GB"
    options: ["GB", "GiB"]
  CDT_SITE_TYPE:
    name: "账户站点"
    default_value: "china"
    options: ["china", "international"]
  CDT_BILLING_ENABLED:
    name: "查询余额和账单"
    default_value: "false"
    options: ["true", "false"]
  CDT_LOCAL_NOTIFY:
    name: "定时阈值通知"
    default_value: "false"
    options: ["true", "false"]
scriptings:
  - generic:
      name: "cdt-{{{MODULE_ID}}}-widget"
      script_url: "https://example.com/release/cdt-widget.js"
      timeout: 20
      update_interval: 86400
  - schedule:
      name: "cdt-{{{MODULE_ID}}}-refresh"
      cron: "*/15 * * * *"
      script_url: "https://example.com/release/cdt-refresh.js"
      timeout: 30
      update_interval: 86400
widgets:
  - name: "CDT Monitor {{{MODULE_ID}}}"
    script_name: "cdt-{{{MODULE_ID}}}-widget"
```

完整模块需补齐第6节env_schema、homepage/manual/author等元数据；示意没有列全。控件默认值必须与代码一致，空秘密不显示为普通默认值。scope/instance/theme个别视图变量不要填模块默认env强制覆盖。

本项目主动发API请求，无需修改用户DNS、代理规则、MITM、http_captures或安装CA。不要套用抓包示例开启全局拦截。若以后实现有必要的本地配置页面或回调，单独解释域名、方法和权限边界，不为了初始化而截获阿里云网页登录凭据。

## 15. 构建、发布与仓库集成

### 15.1 构建工具

推荐Node22、TypeScript、esbuild，锁定依赖。Node仅用于开发/构建/测试，不是Egern运行依赖。

使用 [esbuild官方API](https://esbuild.github.io/api/#platform) 的neutral平台与 [ESM格式](https://esbuild.github.io/api/#format)：`bundle:true, platform:"neutral", format:"esm", splitting:false`。选择经实机验证的语法target；不要声称transpile能补全不存在的宿主API。所有依赖选择不含Node/DOM要求的入口，检查neutral的mainFields/conditions，不能默默 external 掉npm依赖留给Egern解析。

默认输出保留default export、自包含，无静态/动态外部import、require、Node builtin、process.env、Buffer或未核实全局调用。未压缩构建便于诊断；发布压缩保留必要许可证，不附用户信息。

### 15.2 子包与Git规则

[根 .gitignore](<../.gitignore>) 当前会忽略所有package.json/package-lock.json，仅给web例外。后续实现必须添加 `!egern/package.json` 与 `!egern/package-lock.json`，否则构建子包可能存在但未提交。再忽略 `egern/node_modules/`、临时测试输出、本地凭据；选定dist随release分发或提交的策略并保持一致。

不要把构建工具塞进现有React Web包，不改Go模块路径，不在仓库根写真实config.json/.env。原MIT署名保留，引入第三方纯JS库附许可证说明。

约定npm scripts：`build/typecheck/test/check:modules/check:bundles`；必须真实实现，不能在README列不可执行的空脚本。

### 15.3 分发

产物至少：监控module、server module、widget/refresh/diagnostics脚本、安装文档、manifest版本/来源commit/SHA256。控制模块只在实际满足条件时分发，否则列明确未开放能力。

发布YAML中的script_url统一指向同一tag/commit的版本，避免模块固定版本却脚本跟随main漂移。提供更新/回退步骤；placeholder域名、TODO路径和未替换仓库名不能出现在正式release。

新增Egern专用CI检查：依赖锁定安装、typecheck、离线测试、模块校验、bundle校验、构建产物hash。只改Egern时不要求为了此插件启动Go服务、Docker或Android构建；触及这些共享代码才运行对应必要检查。

在[README.MD](<../README.MD>) 添加清晰入口，解释direct/server两种模式与边界；不要重写其他平台安装文档。文档可以本地预览，代码实现完成不等于已经推送/发布远程；公开发布在用户已授权范围内执行。

## 16. 后续 AI 的实施顺序与阶段门槛

不要先堆完整UI，再发现数据范围/签名或宿主无法工作。按下面的顺序推进，每阶段更新 `docs/implementation-status.md`，记录实现文件、实际检查和剩余门槛，避免把计划写成完成日志。

### 阶段0：核对与能力探针

核对当前源码与基线；建立子包、types和只读诊断入口。诊断不读回秘密，只测ctx接口、语法、storage读写、family、App version。提供两脚本/两widget的小型共享缓存探针、cron行为记录步骤、必要crypto/global特性检测。

**门槛**：已记录官方支持与待实机项；已选定缓存不共享时的降级路径。没有设备时继续离线实现，不假装等待设备会自动完成。

### 阶段1：模型、配置与只读数据源

完成第6节模型/验证、签名固定向量、DirectAliyunProvider和CdtServerProvider、只读collector与field-level freshness、去重聚合、错误分类和预算控制。

**门槛**：脱敏fixtures全通过；widget依赖图无控制；同账户多实例流量/额度/余额正确去重；单位/周期待核项清楚。

### 阶段2：原生小组件与基础模块

实现7个family的布局、浅深色、错误/旧缓存状态、SVG进度/趋势与refreshAfter。基础module/env_schema、单账号安装例子能真实生成与导入。

**门槛**：所有正常与异常输出合法DSL；bundle自包含；原生接口没有其他客户端API混用；未知family不崩溃。

### 阶段3：定时采集、有限历史、账单与通知

加入refresh schedule、本地缓存/周期历史、可选账单、已启用告警/日报、多个widget视图、配置变更缓存失效。

**门槛**：休眠/漏执行下不虚构历史，跨月正确降级；接口部分失败不变新鲜；通知策略不会让widget渲染外发。

### 阶段4：控制增强与服务器可靠自动化

按第10节实现独立ControlIntent、policy、automation和uncertain动作恢复。实机无法满足存储/授权门槛时本地控制关闭并交付可用的控制台导航。server模式若需要可靠保护，增量修复第12节列出的后端问题并保持v1兼容。

**门槛**：默认所有控制关闭；离线测试证明未授权0动作；同账户范围控制对象明确；真实云动作不用于测试。不可执行的控制UI不算完成。

### 阶段5：文档、CI、版本化产物与验收

补齐安装、账户RAM权限、参数、单位迁移、能力矩阵、故障处理、回退；构建可加载产物和hash，运行第17节必要检查。

**门槛**：离线完成、实机证据与限制分别列出；没有TODO占位发布地址、空壳核心功能和虚假实测记录。用户未提供真实AK不妨碍完成离线交付，只把云端联调列待验证。

## 17. 测试与验收

有价值测试集中在签名、计量、保护与宿主契约，不机械测试每个getter，不引入无关性能benchmark或真实账户操作。

### 17.1 离线业务用例

| ID | 输入/场景 | 必须结果 |
| --- | --- | --- |
| S01 | 官方GET签名固定向量+源代码POST对拍 | 签名逐字节一致；RFC3986特殊字符与UTF8正确 |
| S02 | HTTP200业务错误、BSS Code=200、响应一次消费 | 成功/失败正确，错误body不会二次读取 |
| T01 | mainland两地域1/2GiB、HK4GiB | 国内3GiB，海外4GiB；siteType不影响分类 |
| T02 | 同账号2实例，另账号1实例 | 共享scope流量/额度/余额只计一次，实例费用分别计 |
| T03 | 同真实账号2个AK | 显式accountId归组；身份未知不假定双份免费额度 |
| T04 | 缺/异常TrafficDetails与已确认有效空列表 | 前者未知/保留旧值；后者按契约为0，不错误解除保护 |
| T05 | 1073741824bytes，quota单位GB/GiB与legacy导入 | 1GiB=1.073741824GB，阈值基于统一bytes |
| T06 | 上限200、threshold95、189.98/190、94.995% | 原始值比较，不先round；缺/零/负quota阻断保护 |
| F01 | 流量成功状态失败及相反、账单失败 | 各自observedAt/error独立；成功字段不被清空 |
| F02 | 控制受理/渲染重新运行 | 不更新trafficObservedAt；旧数据仍stale |
| H01 | 月累计样本10→15、只有2h、无基线 | 5；实际覆盖2h；无基线未知，不称24h精确值 |
| H02 | 旧月100→新月2、同月累计修订 | 跨period分段/partial，修订不视为免费额度重置 |
| H03 | 计划跨午夜日报延期重试 | 固定原周期和统计窗口，不随执行日变化 |
| B01 | 余额0/123.45、账单23.456、TTL6h/失败旧值 | 0非缺失；金额/币种正确；过期与错误可见 |
| B02 | 多实例共享余额、CNY+USD | 不重复，分币种，无自动换汇 |
| C01 | widget/refresh/diagnostics/history/report | Start/Stop调用数=0，包括server POST refresh副作用 |
| C02 | 缺授权/过期意图/错实例/已消费/Unknown | 0动作，有明确阻断说明 |
| C03 | notify_only超限 | 只通知；重复渲染不通知 |
| C04 | 首次超限→停止→再次Running仍超限 | 通知去重与停机保护独立，未被旧闩锁永久阻止 |
| C05 | 超限+计划start+keepAlive、manual stop暂停 | 保护优先，不停后立即被保活启动 |
| C06 | Start/Stop超时、进程在标记前后中断 | uncertain先查询，不盲重放，不伪造confirmed |
| C07 | KeepCharging/StopCharging及云端普通停止回退 | 参数和展示正确，受理不宣称全部停止计费 |
| Q01 | 08:00→次日00:34，08:07/08:11 | 10min内补偿，过窗不补；跨午夜归启动日 |
| Q02 | 非法/全角时间、24:00、start==stop、DST | 明确规范化/拒绝/兼容策略，不字典序误算 |
| N01 | JSON/FORM/Webhook模板特殊字符和业务失败 | 正确编码/失败判断，所有输出无秘密 |
| K01 | schema升级、坏JSON、身份更换、namespace不同 | 正确失效/降级，不串账号；备注改动保留历史 |
| K02 | 同执行合并请求、预算耗尽、部分账号失败 | 请求数受控，渲染不空白，有限并发与退出 |

云写接口由fake provider记录，测试transport拒绝真实阿里云写请求。Node中的宿主fake须不提供Buffer/fetch/crypto等未核实能力，避免测试环境掩盖宿主依赖。对build产物做一次入口烟测，不只测源码。

### 17.2 模块、构建和展示检查

- YAML解析后关联的每个widget.script_name存在且指向generic。
- script_url对应真实生成产物；正式发布地址全部替换并绑定同版本。
- env_schema defaults与代码默认一致；布尔false/空值/JSON错误正确处理；Module>Widget>Script优先级用例通过。
- bundle保留default export，静态检查外部import/Nodebuiltin/其他代理API；读入口无云写执行器。
- 7个family与所有异常状态返回合法节点/属性；未知family安全降级。
- 长名称、超100%、无配额、无历史、0余额/费用均无NaN/Infinity/undefined文本。
- 输出快照、日志、错误、manifest、fixture、SVG、widget.url扫描无假fixture之外的敏感凭据。
- 不把Node渲染对象验证当成iOS实际布局验证；截图和宿主结果分别记录。

### 17.3 必要命令

后续实现对应npm scripts后，在仓库根逐条运行：

```bash
npm --prefix egern ci
npm --prefix egern run typecheck
npm --prefix egern test
npm --prefix egern run build
npm --prefix egern run check:modules
npm --prefix egern run check:bundles
```

仅修改Egern文档/代码时不重复跑整个服务器/Android构建；修改Go共享接口或策略时追加必要 `go test ./...`，按原CI要求做vet/race等；修改Web时运行其既有build及有意义的回归测试。检查所有退出码，失败要查明原因，不能把命令启动等同通过。

### 17.4 Egern 实机记录

至少记录：Egern版本、iOS版本、设备、加载脚本版本/hash、环境配置脱敏摘要。逐项：

1. 本地/远程模块安装，env_schema、默认值和配置修改生效。
2. generic手动预览、iOS桌面和锁屏7类布局；未持有对应设备的family明确未验证。
3. 两个widget同脚本不同选择变量、两份module不同namespace，不串视图/数据。
4. schedule→generic、主App→widget extension的storage共享探针；根据结果启用或关闭共享缓存路径。
5. 网络关闭/恢复、VPN开关、App前后台/强退、锁屏/低电量、设备重启与cron行为，记录实际采集时间。
6. refreshAfter实际效果、UTC/时区正确性、核心API只读联调和RAM不足错误。
7. 自动控制默认关闭、read调用0动作；控制流程只用模拟目标或用户另行授权的非生产实例，不为验收擅自启停真实资源。

不能通过提高频率到每秒、循环常驻、滥用network hook来弥补iOS刷新限制。

## 18. 安装、迁移、故障处理与最终交付

README的普通用户路径必须简短：

1. 选择direct独立模块或server只读模块，添加模块URL。
2. 在Egern模块Env填写对应凭据/地址和需要的额度，保存；direct先使用只读RAM凭据。
3. 打开Analytics的小组件库预览数据，确认范围与单位；错误提示引导修正具体字段。
4. iOS长按桌面添加Egern小组件，编辑选中`CDT Monitor`；锁屏按对应family添加。
5. 需要阈值通知才启用通知；需要云控制才按独立章节配置并确认手机端可靠性限制。

高级章节包含多账号JSON、多个widget、账户scope去重、GB/GiB、账单站点与币种、缓存/历史、不共享storage降级、控制意图、server API权限、更新/回滚。JSON不能进install URL，截图不能带Secret。

从现有Go配置迁移时由用户在本地重新配置或受控导出不含秘密的模型；服务端加密Secret不能由widget:read接口导出。旧历史可以继续server模式读取，独立模式从安装后采样，不宣称已经继承未导入的30天历史。

常见故障必须覆盖：未配置AK/额度、AccessDenied、Signature错误、时间戳、CDT未开通/响应不可识别、ECS实例不匹配、BSS站点错、API限流、脚本超时、后台不执行、旧缓存、模块env覆盖widget设置、Token撤销、SVG失败、旧bundle版本不一致。

后续AI最终回报至少包含：

- 实际新增/修改的关键文件与使用方法，给可点击位置。
- 当前direct/server各自真实完成的能力，控制是否开放及原因。
- 构建、离线检查与实机/云端联调分别的结果；未执行项明确未执行。
- 可安装YAML、脚本、版本/hash、必要配置示例、安装/回退文档。
- 明确iOS后台与云API统计延迟的限制，不声称绝对防超额。

不得以“已经分析”“框架已搭好”“后续可以再实现”替代用户已要求的完整实现。遇到未确认宿主能力先完成不依赖它的工作，采用本文件规定的降级，并给出精确缺口。

## 19. 完成检查清单

- [ ] 源码基线及后续差异已核对，旧PHP文档未被误用。
- [ ] direct独立插件可离线完整运行，server只读provider可兼容v1真实DTO。
- [ ] 账号、凭据、CDT scope、ECS实例分层，多AK/多实例不会重复额度与余额。
- [ ] bytes/GB/GiB、历史累计、周期、观测时间、账单与未知数据口径明确。
- [ ] Egern原生ctx与DSL使用正确，所有bundle自包含，7类family有降级与合法输出。
- [ ] 缓存不共享/坏数据/超时/部分失败不导致空白或假新鲜数据。
- [ ] widget/普通refresh/diagnostics无云控制或旧后端refresh副作用。
- [ ] 自动控制默认关闭，显式目标、一次性意图/策略许可、保护优先级、uncertain恢复成立。
- [ ] 无可靠本地控制能力时给可工作的控制台入口和明确限制。
- [ ] 只读RAM/可选BSS/控制权限分别说明，秘密不进入公开文件和输出。
- [ ] 模块、脚本、npm scripts、CI、版本URL、hash、安装与回退文档真实可用。
- [ ] 离线结果、Egern实机结果、真实云联调结果严格分开，没有虚构“全通过”。
- [ ] MIT与作者署名保留，原Go/Web/Android版本和API兼容性符合范围。

## 20. 资料索引与待核事项

项目来源：[wang4386/CDT-Monitor](https://github.com/wang4386/CDT-Monitor)，审查commit见文首。

官方Egern接口以第3节链接为准；正确脚本配置路径是`/docs/configuration/scriptings/`，不是返回404的`/scripting/`。

阿里云参考：[CDT计价](https://www.alibabacloud.com/help/en/cdt/internet-data-transfers/)、[传统RPC签名](https://www.alibabacloud.com/help/en/sdk/product-overview/rpc-mechanism)、[V3签名](https://www.alibabacloud.com/help/en/sdk/product-overview/v3-request-structure-and-signature)、[经济停止](https://www.alibabacloud.com/help/en/ecs/user-guide/economical-mode)。版本变化时复核，不把本次价格/额度资料当永恒规则。

实施时必须解决或明确保留的核对项：ListCdtInternetTraffic可用性/范围/周期/单位/有效空列表/RAM、各接口签名支持与分页、ECS精确筛选、StopCharging实际模式字段、Egern跨上下文storage、运行时加密与nonce、定时/锁屏行为、一次性控制意图与确认机制。任何一项未核实不得补成看似确定的平台事实。
