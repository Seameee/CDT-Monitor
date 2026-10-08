# 验收记录

> 记录日期：2026-10-08。**仅包含离线验证结果。**
> Egern/iOS 实机验收与真实云账号联调**均未执行**，见文末。
>
> 复现命令（在 `egern/` 下）：
> ```bash
> npm run typecheck && npm test && npm run build && npm run check:modules && npm run check:bundles
> ```

## 0. 命令结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 退出码 0 |
| `npm test` | **206 项通过 / 0 失败** |
| `npm run build` | 生成 5 脚本 + 1 模块 + `manifest.json` |
| `npm run check:modules` | 通过 |
| `npm run check:bundles` | 通过（含读写边界断言） |

---

## 1. 离线业务用例（主文档 §17.1）

| ID | 场景 | 结果 | 覆盖位置 |
| --- | --- | --- | --- |
| S01 | 官方 GET 签名固定向量 + 源码 POST 对拍 | **通过**：GET = `9NaGiOspFP5UPcwX8Iwt2YJXXuk=`；POST = `ZvQ9xGiFnquSJRvj+WE6kdSpTwU=`（与 Go 源码逐字节一致）；RFC3986 特殊字符与 UTF-8 正确 | `tests/signing.test.ts` |
| S02 | HTTP200 业务错误、BSS `Code=200`、响应只消费一次 | **通过**：业务错误判为失败；`Code=200` 判为成功；`text()` 只调用 1 次 | `tests/rpc.test.ts`、`tests/traffic.test.ts` |
| T01 | 国内两地域 1/2GiB、HK 4GiB | **通过**：国内 3GiB、海外 4GiB；`siteType` 不影响分类 | `tests/traffic.test.ts` |
| T02 | 同账号 2 实例 + 另账号 1 实例 | **通过**：共享 scope 只请求 1 次、只出现 1 次；实例各自计费 | `tests/collection.test.ts` |
| T03 | 同真实账号 2 个 AK | **通过**：余额按 account 只查 1 次；身份未知不假定双份额度 | `tests/collection.test.ts` |
| T04 | 缺/异常 `TrafficDetails` vs 已确认空列表 | **通过**：缺失→未知；空数组→确认 0；不据此解除保护 | `tests/traffic.test.ts` |
| T05 | 1073741824 bytes、GB/GiB 与 legacy 导入 | **通过**：1GiB = 1.073741824GB；阈值基于统一 bytes | `tests/usage.test.ts` |
| T06 | 上限 200 / 阈值 95 / 189.98 / 190 / 94.995% | **通过**：原始值比较；缺/零/负 quota 阻断保护；94.995% 不触发（尽管显示 95.00%） | `tests/usage.test.ts` |
| F01 | 流量成功但状态失败，及相反 | **通过**：各自 `observedAt`/`error` 独立；成功字段不被清空 | `tests/collection.test.ts` |
| F02 | 控制受理 / 重新渲染 | **通过**：只读采集不更新 `trafficObservedAt`；旧数据仍标陈旧 | `tests/collection.test.ts`、`tests/policy.test.ts` |
| H01 | 月累计 10→15、只有 2h、无基线 | **通过**：得 5；覆盖 2h；无基线→未知，不称 24h 精确值 | `tests/history.test.ts` |
| H02 | 旧月 100→新月 2、同月累计修订 | **通过**：跨 period 标 partial、不给 delta；修订标 revision 且不视为额度重置 | `tests/history.test.ts` |
| H03 | 计划跨午夜日报延期重试 | **逻辑通过**：跨午夜周期归属由 `scheduleCycleDate` 覆盖（同一实现用于日报锚定）；**端到端日报入队未单测** | `tests/history.test.ts`（周期归属） |
| B01 | 余额 0/123.45、账单 23.456、TTL 6h/失败旧值 | **通过**：0 非缺失；金额正确；TTL 与新周期失效可见 | `tests/traffic.test.ts`、`tests/collection.test.ts` |
| B02 | 多实例共享余额、CNY+USD | **通过**：不重复；分币种；无自动换汇 | `tests/usage.test.ts`、`tests/collection.test.ts` |
| C01 | widget/refresh/diagnostics/history/report | **通过**：`StartInstance`/`StopInstance` 调用数 = 0；`check:bundles` 静态断言只读 bundle 不含写执行器 | `tests/entries.test.ts`、`scripts/check-bundles.mjs` |
| C02 | 缺授权/过期意图/错实例/已消费/Unknown/未自证 | **通过**：0 动作，且每种都有明确阻断码与说明；另验证「自证后确实会执行」 | `tests/policy.test.ts` |
| C03 | `notify_only` 超限 | **通过**：只通知不停机；重复刷新不重复通知 | `tests/policy.test.ts`、`tests/entries.test.ts` |
| C04 | 首次超限→停止→再次 Running 仍超限 | **通过**：保护基于当前观测重新生效，未被旧闩锁永久阻止（且幂等键不同） | `tests/policy.test.ts` |
| C05 | 超限 + 计划 start + keepAlive、manual stop 暂停 | **通过**：保护优先；`pauseUntil` 抑制保活 | `tests/policy.test.ts` |
| C06 | Start/Stop 超时、进程在标记前后中断 | **通过**：先置消费标记；超时标 `uncertain`；非幂等请求不重放；不伪造 confirmed | `tests/policy.test.ts`、`tests/rpc.test.ts` |
| C07 | KeepCharging/StopCharging 及回退 | **通过**：参数正确；受理只显示「已受理」；与策略冲突的停机模式被拒绝而非升级 | `tests/policy.test.ts` |
| Q01 | 08:00→次日 00:34，08:07/08:11 | **通过**：10 分钟窗内补偿、过窗不补、跨午夜归启动日、不反向绕回 | `tests/history.test.ts` |
| Q02 | 非法/全角时间、24:00、start==stop、DST | **通过**：全角归一、`24:00`→`00:00`、越界拒绝、`start==stop` 拒绝、DST 经 `Intl` 正确 | `tests/history.test.ts` |
| N01 | JSON/FORM/Webhook 模板特殊字符与业务失败 | **通过**：JSON 转义（含中文键、引号、反斜杠、换行、NUL）、Telegram `ok=false` 与 `errcode≠0` 判为失败、输出无秘密 | `tests/notifications.test.ts` |
| K01 | schema 升级、坏 JSON、身份更换、namespace 不同 | **通过**：身份/命名空间/provider 变更→未命中；坏缓存当未命中；名称变更不清空历史 | `tests/collection.test.ts` |
| K02 | 同执行合并请求、预算耗尽、部分账号失败 | **通过**：并发 ≤ 2、一次 scope 一次请求、部分失败不空白且有明确错误 | `tests/collection.test.ts` |

### 云写接口隔离

- 所有测试使用 fake provider / fake transport；**没有任何测试发起真实阿里云请求**；
- `tests/host-fake.ts` 刻意**不提供** `Buffer`/`fetch`/`crypto`/`TextEncoder`/`process`/timers，
  以免测试因 Node 全局恰好存在而误通过；
- 控制执行器只有在 capability 双前提为真时才会被实例化，离线测试中始终为假。

---

## 2. 模块、构建与展示检查（主文档 §17.2）

| 检查项 | 结果 |
| --- | --- |
| 每个 `widget.script_name` 存在且指向 generic | 通过（单模块设计；`check:modules` + `tests/module.test.ts`） |
| `script_url` 对应真实产物，无占位域名/TODO | 通过（`@@RELEASE_BASE@@` 在构建期替换） |
| `env_schema` 默认值与代码默认一致 | 通过（显式对照表，不一致即失败） |
| 布尔 false / 空值 / JSON 错误正确处理 | 通过（严格解析；非法 JSON 直接报错不降级） |
| Module > Widget > Script 优先级用例 | 通过（视图变量禁止写进模块/脚本 env） |
| bundle 保留 default export、无外部 import/Node builtin/其他客户端 API | 通过（`check:bundles`） |
| 读入口不含云写执行器 | 通过（静态标记断言；且断言 `cdt-control.js` 确实含标记，避免检查空转） |
| 7 个 family 与所有异常状态返回合法节点/属性 | 通过（`tests/widget.test.ts`，枚举全部 7 family × 多状态） |
| 未知 family 安全降级 | 通过 |
| 长名称、超 100%、无配额、无历史、0 余额均无 NaN/Infinity/undefined | 通过（逐 family × 逐状态扫描全部字符串） |
| 快照/日志/错误/manifest/fixture/SVG/widget.url 无敏感凭据 | 通过（诊断与通知均断言不含秘密） |
| 不把 Node 渲染验证当作 iOS 实际布局验证 | 遵守：布局仅为离线 DSL 断言，实机排版未验证 |

**尺寸**：全部 bundle 均低于 200KB 项目预算（最大 `cdt-widget.js` 约 147KB）。
**SVG**：本地生成，自设 64KB 上限（官方上限 512KB）；颜色使用 `rgb()`，避免 `#` 截断 data URI。

---

## 3. 未执行的验收

### 3.1 Egern / iOS 实机（§17.4）— **未执行**

需要记录：Egern 版本、iOS 版本、设备、加载脚本版本/hash、脱敏后的环境摘要。逐项清单见
[compatibility.md](compatibility.md)。当前**没有**任何截图、日志或通过记录，
也**不声称**任何实机行为已验证。

### 3.2 真实云账号只读联调 — **未执行**

未使用任何真实 AK，未调用任何真实阿里云接口。因此：

- `ListCdtInternetTraffic` 的 **单位**仍然未知（见 `aliyun-api-contract.md` §B4）；
- 不得据本文件声称「direct 模式已联调成功」；
- 需要用户在授权范围内自行执行 `aliyun-api-contract.md` 第 F 节的 12 项核实。

### 3.3 未通过提高频率弥补刷新限制

未使用每秒轮询、常驻循环或 network hook 滥用；
`refreshAfter` 仅作为意图写入，不承诺实际刷新时间。
