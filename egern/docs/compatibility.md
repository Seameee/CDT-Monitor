# Egern 宿主能力与兼容性记录

> **当前状态：尚未进行任何 Egern / iOS 实机验证。**
> 本文件记录哪些能力来自官方文档（可依赖）、哪些属于未证实的假设（必须实测），
> 以及每项在未证实时本项目采取的降级方案。
>
> 记录日期：2026-10-08。平台依据：Egern 官网文档（JavaScript API、Scripting、
> Widgets、Modules、Environment Variables、URL Scheme）与阿里云官方生成 SDK。
>
> **本文件中所有标为「待实机验证」的项目都没有通过真机测试。**
> 不得把本文件当作实测报告，也不得据此外推未验证行为。

---

## 1. 能力矩阵

| 能力 | 依据 | 状态 | 本项目的处理 |
| --- | --- | --- | --- |
| `export default async function(ctx)` | 官方文档 | 官方契约 | 全部入口使用 |
| `ctx.env` 字符串键值对 | 官方文档 | 官方契约 | 严格解析；不使用 `Boolean("false")` |
| `ctx.http.get/post` + `headers/body/timeout/redirect/credentials` | 官方文档 | 官方契约 | 只发主动 POST/GET；显式传 `credentials:"omit"` |
| `ctx.storage.get/set/getJSON/setJSON/delete`（同步） | 官方文档 | 官方契约 | 全部缓存与事件去重都走它 |
| `ctx.notify({title,body,sound,action})` | 官方文档 | 官方契约 | 仅 schedule 入口发送 |
| `ctx.widgetFamily`（7 个取值） | 官方文档 | 官方契约 | 7 个 family 各自布局 + 未知值降级 |
| `ctx.cron` | 官方文档 | 官方契约 | 仅用于记录，不用于时间判断 |
| `ctx.app.version` / `ctx.app.language` | 官方文档 | 官方契约 | 仅用于脱敏诊断 |
| Widget DSL 节点 `widget/stack/text/image/spacer/date` | 官方文档 | 官方契约 | 只使用这 6 种节点 |
| `refreshAfter` 为 ISO 8601 未来时间 | 官方文档 | 官方契约 | 始终写入严格未来时间 |
| 内联 SVG `data:image/svg+xml,` + 512KB 上限 | 官方文档 | 官方契约 | 本地生成；自设 64KB 上限 |
| env 优先级 Module > Widget > Script | 官方文档 | 官方契约 | 视图变量只放 widget env |
| `compat_arguments` 的 `{{{KEY}}}` 文本替换 | 官方文档 | 官方契约 | 仅用于 `MODULE_ID` 名称前缀 |
| `env_schema` 仅 `name/description/default_value/options` | 官方文档 | 官方契约 | 校验脚本强制检查；default 与代码默认值一致 |
| **`ctx.storage` 跨执行/跨上下文共享** | 文档未承诺 | **部分实测**：同模块 schedule→generic 已观测共享；跨 profile、widget 扩展与主 App 仍未知 | 见 §2、§9 |
| **`ctx.storage` 事务/CAS/TTL/枚举** | 文档未提供 | **确认不存在** | 不使用；改为按已知 key 集合管理 |
| **安全随机数（`crypto.getRandomValues`）** | 文档未提供 | **实测可用** | 运行时探测；缺失时降级并如实标注 |
| `TextEncoder` / `btoa` / `atob` | 文档未提供 | **实测可用** | **仍然完全不依赖**：自行实现 UTF-8/Base64/SHA-1 |
| 全局 `fetch` | 文档未提供 | **实测可用** | **不使用**；只用 `ctx.http` |
| 跨文件 `import`（运行时） | 文档未提供 | **待实机验证** | 构建期打包成单文件，运行时不依赖 |
| `ctx.confirm` / `ctx.source` / `scripts/run` | 文档未提供 | **确认不存在** | 不调用；控制确认改用一次性意图 |
| `Intl.DateTimeFormat` 任意时区 | 文档未提供 | **待实机验证** | 运行时探测；失败时降级到固定 +08:00 或停用本地定时 |
| Node `require/fs/Buffer/process` | 文档未提供 | **确认不存在** | 不依赖；`check:bundles` 静态禁止 |
| Surge/Loon/QX/Scriptable 的 `$httpClient`/`$done`/`ListWidget` | 非 Egern API | **明确不是契约** | 不使用；`check:bundles` 静态禁止 |
| ECMAScript 语法版本（target `es2020`） | 文档未提供 | **待实机验证** | 保守 target；transpile 无法补足缺失的宿主 API |

---

## 2. 缓存共享：默认按「不共享」设计（关键降级）

官方文档**没有**说明以下任意一项：

1. 不同 `generic` / `schedule` / `script.name` / module / profile 之间是否共享 storage；
2. widget 扩展与主 App 之间是否共享；
3. 多 widget 并发刷新时的写入竞争、持久化时机与 iCloud 同步行为。

**因此本项目默认按「不共享」实现**：

- `cdt-widget.js` 自己完成「读本上下文缓存 → 必要时只读采集 → 渲染」。
  它**不会**等待某个 `schedule` 写下的 key。缓存未命中就自己发一次只读请求。
- `cdt-refresh.js` 只负责自己的采集、通知与历史写入，不假设 widget 能读到。
- 缓存读写都带 `namespace` + `provider` + 配置指纹校验，读到其它身份的数据一律当未命中。

即使用户设备上确实共享，也不会出错（只是多一次请求）；反之若假设共享而实际不共享，
widget 会永久空白。该降级方向是刻意选择的。

**实机验证步骤（待执行）**：

1. 装两份 module（不同 `MODULE_ID`）、两个 widget 指向不同脚本；
2. 在 A 脚本 `set` 一个 key，在 B 脚本 `get` 同一 key，记录是否命中；
3. 在 widget 与主 App 之间重复；
4. 触发两个 widget 同时刷新，观察是否出现写入丢失或旧值覆盖；
5. 结果记入本文件并据此决定是否启用共享缓存路径。

---

## 3. 控制能力：默认关闭，可经显式自证开启

本地实例启停（含保活）需要同时满足两个**只能在真机证明**的前提：

| 前提 | 含义 | 默认 |
| --- | --- | --- |
| `crossExecutionIntentClaim` | 一次性意图的「已消费」标记能可靠跨执行持久化 | `false` |
| `hostSerializesSameTarget` | 宿主能可靠串行执行同一目标的脚本，或云端动作幂等 | `false` |

**这两项由你自己声明**，写在 `CDT_CONTROL_JSON.deviceVerification` 里，并且必须同时填写
`verifiedAt`（缺了会被配置校验拒绝，避免出现没有日期的"验证记录"）。这是**自证**而非证明：
代码无法离线核实，所以设计上把它做成一个独立、具名、带日期的动作，而不是顺带被别的开关打开。

开启后的三层闸门（全部满足才会真正发出云写请求）：

1. `enabled: true`；
2. `deviceVerification` 两项均为 `true` 且 `verifiedAt` 合法；
3. 目标实例在 `allowedInstanceIds` 内，且 `instances[]` 中声明了对应策略。

任一层不满足时：`cdt-control.js` 只校验意图并给出拒绝原因；`cdt-automation.js` 只评估策略、
发送通知，并记录每个被扣下的动作。**都不会产生云写。**

> 说明：模块里的两个控制脚本**没有**写成 `disabled: true`。因为模块是从 URL 安装的、
> 你无法编辑它，若脚本被禁用就无法"只靠配置开启"。安全性改由上述三道代码级默认关闭保证——
> `enabled=false` 时脚本在任何网络请求之前就返回（有测试断言请求数为 0）。
> 另外控制只在 `CDT_MODE=direct` 下可用：`server` 模式没有云端凭据，
> 配置 `enabled=true` 会被明确拒绝并保持关闭。

### 如何验证这两个前提（请自己做，**尚未执行**）

**前提 1 — 跨执行意图持久化**

1. 记录一次写入的 `nonce`，或先用一个自造 key 做探针；
2. **强退 Egern**（上滑关闭），再重新打开并手动运行一次诊断脚本；
3. 能否重新读到该 key？读到=可持久化；读不到=**不可**，请保持关闭。

**前提 2 — 同目标串行执行**

1. 用**非生产**实例，准备两条 `CDT_CONTROL_INTENT_JSON`（不同 nonce、同一目标）；
2. 尽量同时触发两次运行（例如快速连续手动执行）；
3. 观察是否出现两次 `StartInstance`/`StopInstance`；出现并发即**不满足**，请保持关闭。

**确认最终状态**：`DescribeInstanceStatus` 返回 `Stopped`/`Running` 才算真正完成；
接口受理成功只代表"已受理"。

**明确不成立的说法**：本项目**不**声称「读后写标记」能提供 exactly-once，
**不**声称本地 KV 提供事务或强一致，也**不**声称 `refreshAfter`/cron 能保证按时唤醒。

### 保活测试顺序（推荐：先演练，再验证写入，最后测时效）

> ⚠️ **测试前必查**：确认 Egern 通往 `*.aliyuncs.com` 的流量**不经过**你正在测试的那台实例。
> 若该实例是 Egern 的唯一出口节点，关机后阿里云 API 也调不通，保活**在物理上无法成功**，
> 这不是代码问题。用 Wi-Fi 直连、另一节点，或给阿里云域名加直连规则。

**为什么不能只"关机然后等"**：automation 是 schedule 脚本，iOS 什么时候唤醒它不由你控制。
直接关机干等，你无法区分「逻辑没生效」「权限不足」「iOS 还没唤醒」这三种完全不同的原因。
所以分成三步，每步只验证一件事。

#### 第 1 步：演练（不写云端，不需要自证）

1. 配 `CDT_CONTROL_JSON`：只写 `{"schemaVersion":1,"enabled":true,"keepAlive":true}`，
   **先不要填 `verifiedOnDevice`**；
2. 把 `CDT_LOCAL_NOTIFY` 设为 `true`；
3. 在云控制台**手动关机**；
4. 等 automation 跑一次（cron 是 5 分钟，但实际取决于 iOS）。

**预期**：收到一条「**CDT 保活未执行**」通知，说明「它想开机，但因为没有声明真机验证所以没做」。
这一步证明**策略判断正确、凭据能读到实例状态**，且**没有任何云端写操作**。

也可以手动运行一次 **`cdt-main-diagnostics`**，看「上次自动策略」段落：
它显示的**运行时间**是判断 iOS 有没有唤醒脚本的唯一依据。

#### 第 2 步：验证写入路径（此时才加自证）

1. 给 `CDT_CONTROL_JSON` 加上 `"verifiedOnDevice":"<你验证的日期>"`（或完整的 `deviceVerification`）；
2. 实例保持关机，等 automation 再跑一次；
3. **预期**：收到「**CDT 保活：已发送开机指令**」通知；
4. 去云控制台确认实例确实变成**运行中**。

若第 3 步收到的是「未执行（Withheld）」，说明自证没生效；若通知里是 `AccessDenied`，
则是 RAM 权限问题——**不是逻辑问题**。

#### 第 3 步：测时效（唯一需要耐心的一步）

重复第 2 步，记录**从关机到收到通知的间隔**。这才是 iOS 唤醒行为的真实数据。
建议至少观测 2–3 次，因为 iOS 的调度是机会性的。

**判断表**：

| diagnostics 显示 | 含义 |
| --- | --- |
| 「暂无记录」或运行时间很久以前 | iOS 还没唤醒脚本 —— **不是逻辑或配置问题** |
| 有运行记录，`动作 ... → Withheld` | 自证未生效（两个 flag 或 `verifiedAt`） |
| 有运行记录，`动作 ... → AccessDenied` | RAM 凭据缺少 `StartInstance` 权限 |
| 有运行记录，`动作 ... → Accepted` 但实例仍关机 | 云端受理了但没起来，查云控制台实例状态 |
| 有运行记录，无任何决策 | 策略条件不满足（超阈值 / 不在允许时段 / 已暂停） |
| 实例显示「**停止中**」 | 这是**过渡状态**（Stopping），策略刻意不动作：此时下发开机只会失败或冲突。等它变成「已停止」 |

> 注意：`cdt-main-diagnostics` 读取 automation 写的运行记录，**依赖跨上下文缓存共享**，
> 而这一点 Egern 未文档化。因此**通知是可靠信号，diagnostics 是方便信号**——
> 收不到记录不代表脚本没跑。

### 即使开启，保活也不可靠

iOS 不保证定时脚本被唤醒（后台、锁屏、低电量、强退都会跳过），`*/5` 只是"每 5 分钟尝试一次"，
且 cron 时区官方未文档化。因此本项目的保活定位为**最佳努力**：

- 不得宣传为「保证按时拉起」「可靠保活」；
- 机器停机后可能拖延数分钟到"下次打开 App"；
- 要求及时、可靠拉起时，请使用 Go 后端的常驻保活。

---

## 4. 定时与时区行为（待实机验证）

| 问题 | 状态 | 本项目的处理 |
| --- | --- | --- |
| cron 使用哪个时区 | 待实机验证 | **不依赖**：把 cron 当作「触发器」，在代码内按配置时区判断是否到点 |
| 漏执行是否补跑 | 待实机验证 | 只保留 10 分钟（启停）/ 20 分钟（日报）短补偿窗，过窗不补 |
| 锁屏 / 低电量 / 后台 / 强退 / 重启后的行为 | 待实机验证 | 采集结果只是「尝试过」，UI 显示真实采样年龄而非「实时」 |
| `Intl` 是否支持 IANA 时区 | 待实机验证 | 运行时探测（`src/domain/timezone.ts`） |
| `refreshAfter` 的实际效果 | 待实机验证 | 只作为「意图」写入，不承诺刷新时间 |

**时区降级策略**：探测不到可用的 `Intl` 时，

- `Asia/Shanghai` 仍可精确处理（自 1991 年起固定 UTC+8、无夏令时）；
- 其他时区一律**停用本地定时与日报**并给出明确原因，绝不猜测偏移。

---

## 5. Widget 渲染（待实机验证）

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 7 个 family 的实际布局 | 待实机验证 | 离线已保证产出合法 DSL；实际排版未测 |
| `systemExtraLarge` | 待实机验证 | 仅 iPad 提供，**未持有对应设备** |
| 深浅色自适应 | 待实机验证 | 使用 `{light,dark}` 自适应颜色，实际对比度未测 |
| 内联 SVG 的渲染 | 待实机验证 | 遵循官方要求带 `xmlns`/`viewBox`，颜色用 `rgb()` 避免 `#` 截断 URI |
| 系统大字体下的布局 | 待实机验证 | 使用语义字号 + `maxLines`/`minScale`，未实测 |
| 长中文/英文名称 | 待实机验证 | 按**码点**截断，不会切开代理对 |
| 手动运行（无 family） | 待实机验证 | 降级为简化 medium 布局，不抛异常 |

**未验证设备**：`systemExtraLarge`（iPad）当前无设备可测，记录为未验证。

---

## 6. 签名与加密（离线已验证 / 宿主待验证）

| 项目 | 状态 |
| --- | --- |
| RFC 3986 百分号编码（含 `!'()*` 与 `~`） | **离线已验证**（对照 Go 源码逐字节一致） |
| SHA-1 / HMAC-SHA1 / Base64 / UTF-8 | **离线已验证**（RFC 2202 与标准向量） |
| 阿里云官方签名固定向量（GET） | **离线已验证**：`9NaGiOspFP5UPcwX8Iwt2YJXXuk=` |
| POST 对拍原 Go 实现 | **离线已验证**：`ZvQ9xGiFnquSJRvj+WE6kdSpTwU=` |
| 宿主的随机数强度 | **待实机验证**：缺失时降级为「时间+计数+Math.random」，不视为加密安全 |
| 真实账号的只读联调 | **未执行**（无授权账号） |

---

## 7. 阿里云接口（待核实项见 aliyun-api-contract.md）

`ListCdtInternetTraffic` 的 `Traffic` **单位未在任何官方页面或 SDK 中声明**。
本项目按字节处理并在 UI 上标注「接口累计（统计周期待确认）」，
**不声称用量数值绝对准确**。

完整待核实清单见 [aliyun-api-contract.md](aliyun-api-contract.md) 第 F 节。

---

## 9. 实机观测记录

**性质说明**：以下由**用户在自己的设备上执行**得到，不是本项目自动测试的产物。
原文是 `cdt-main-diagnostics` 的原始 Widget DSL 输出，未经改写。单次观测，**不能**外推到
其他 Egern 版本、其他 Profile 或其他用户。

### 2026-10-08 · Egern 2.21.0 · iOS · 直连模式

来源：用户手动运行 `cdt-main-diagnostics`（作为 `systemMedium` 小组件）的输出。

| 观测项 | 结果 |
| --- | --- |
| `ctx.app.version` | `2.21.0`（可读） |
| `crypto.getRandomValues` | 可用 → **nonce 有加密强度来源** |
| `TextEncoder` | 可用 |
| `btoa` / `atob` | 可用 |
| 全局 `fetch` | 可用 |
| `ctx.http` / `ctx.storage` / `ctx.notify` | 均可用 |
| `ctx.widgetFamily` | 可用（本次为 `systemMedium`） |
| `ctx.cron` | generic 脚本「未提供」——与官方文档一致（cron 只属于 schedule） |
| **schedule 脚本自动执行** | **已观测**：automation 在无人干预下执行并写下运行记录 |
| **跨上下文 storage 共享** | **已观测**：`schedule`（automation）写下的运行记录，被 `generic`（diagnostics）读到 |
| **云写路径** | **已观测成功**：`动作 start → Accepted instance-main`，即 `StartInstance` 被云端受理 |

**这几条的实际意义**：

- 「schedule 会不会被自动唤醒」不再是纯理论问题——**它确实跑起来了**；但**跑了多少次、间隔多准**
  仍未测量（见 §4）。
- 跨上下文共享**至少在同模块的 schedule→generic 方向成立**，这比项目原先假定的
  「默认不共享」更乐观。项目仍按不共享实现（§2），因为多一次只读请求的代价远小于 widget 永久空白。
- `crypto.getRandomValues` 可用意味着 §6 的随机数降级路径在实际设备上**不会被触发**。

### 2026-10-08 · 后续观测：两个脚本读到的配置不一致

同一天稍后，用户把 `verifiedOnDevice` 加进配置后再跑诊断，出现**方向相反**的矛盾：

| 来源 | 显示 |
| --- | --- |
| `cdt-main-diagnostics`（手动，作为 widget 运行） | `写入能力：已声明通过真机验证（2026-10-08）` |
| `cdt-automation`（schedule，1 分钟前自动运行）的同一段记录 | `模式：仅演练（未声明真机验证，不会写入）` |

`模式` 正是**由**验证状态算出来的（`mode = 验证通过 ? live : dry-run`），所以同一个配置
不可能同时得出这两个结论。**结论：两个入口读到的 `CDT_CONTROL_JSON` 不是同一份。**

最可能的原因（按可能性排序）：

1. **变量填在了小组件上，而不是模块上**。env 优先级是 Module > Widget > Script，
   widget env 只对 widget 渲染生效；`schedule` 入口看不到它。
   诊断脚本常被当作 widget 来查看，于是就出现「诊断说验证了、automation 说没验证」。
   **`CDT_CONTROL_JSON`、`CDT_LOCAL_NOTIFY` 这类影响自动化行为的变量必须填在模块上**，
   填在小组件上对 schedule 完全无效。
2. 装了两份模块，各自的 env 不同，而两者写入同一个缓存 key，谁后跑就覆盖谁。
3. 模块内容被缓存（`update_interval`），改动未刷新。

**为此新增了「控制配置指纹」**（`controlFingerprint`，12 位十六进制，不含任何秘密）：

- 诊断里打印**本次**读到的控制配置指纹；
- automation 把**它当时**读到的指纹写进运行记录；
- 诊断读到运行记录时会比对两者，一致显示「与本次一致」，不一致则明确显示
  `≠ 本次 … —— 两次读到的控制配置不同！`

这样这类问题可以**自证**，不需要再靠猜。

**仍然未知（不要因为上表而放松）**：

1. widget 扩展与主 App 之间是否共享 storage；
2. 多个 Profile / 多个模块实例之间是否共享；
3. iOS 唤醒 schedule 的实际频率与延迟分布；
4. 跨执行持久化的**可靠边界**（例如设备重启、App 被杀死之后是否仍在）。

---

## 8. 如何填写本文件

实机测试后，请把对应行的「待实机验证」替换为：

```
状态：已验证（YYYY-MM-DD）
环境：Egern <版本> / iOS <版本> / <设备型号>
脚本：<入口文件名> @ <commit 或 sha256 前 12 位>
结果：<观察到的事实>
降级：<若与假设不符，实际启用的降级路径>
```

**不要**在没有真实测试的情况下把任何一行改为「已验证」。
