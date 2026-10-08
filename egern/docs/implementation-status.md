# 实现状态

> 记录日期：2026-10-08。源码基线 commit：`ad152f04efccf1093e791a8a839d7a3fa64527d1`（与审查基线一致，无差异）。
>
> **本文件区分三类结果，请不要混读：**
> - **离线已完成**：有可复现的命令与结果；
> - **待实机验证**：需要 Egern / iOS 设备，**尚未执行**；
> - **待云端联调**：需要用户授权的真实只读账号，**尚未执行**。
>
> 未执行的项目一律标为未执行，不以「已分析」「框架已搭好」替代。

---

## 一、离线已完成

| 项目 | 证据 |
| --- | --- |
| TypeScript 类型检查 | `npm run typecheck` 退出码 `0` |
| 离线测试 | `npm test`：**218 项全部通过，0 失败** |
| 构建 | `npm run build`：5 个脚本 + 1 个模块 + `manifest.json` |
| 模块校验 | `npm run check:modules` 通过 |
| 产物校验 | `npm run check:bundles` 通过（含读写边界断言） |

### 构建产物（commit `ad152f0`）

| 产物 | 大小 | SHA-256 前 12 位 |
| --- | --- | --- |
| `cdt-widget.js` | 149757 B | `8c36e11e2c85` |
| `cdt-refresh.js` | 124914 B | `5b21f4983f30` |
| `cdt-diagnostics.js` | 59966 B | `09d955bacb26` |
| `cdt-control.js` | 128172 B | `e7400f627fce` |
| `cdt-automation.js` | 140780 B | `02b1628c451d` |
| `cdt-monitor.yaml` | 8613 B | `5756d79bae80` |

全部脚本均低于 200KB 的项目预算（非平台硬限制）。完整校验和见 `dist/manifest.json`。

发布地址由构建时的 `origin` 远端与分支推导（可用 `CDT_REPO_SLUG` / `CDT_RELEASE_REF` /
`CDT_RELEASE_BASE_URL` 覆盖）。`manifest.json` 的 `commit` 字段由 CI 通过
`CDT_SOURCE_COMMIT` 写入——本地构建无法得知"包含自己的那个 commit"，因此本地为 `null`
（这也让构建可复现：连续两次构建产出完全一致）。本次为：

```text
https://raw.githubusercontent.com/Seameee/CDT-Monitor/main/egern/dist
```

发布正式版本时应传入不可变的 tag（`CDT_RELEASE_REF=vX.Y.Z`），使模块与脚本固定在
同一版本；当前指向分支是为了让首次上传后即可安装。

### 已实现的能力

| 层 | 文件 | 状态 |
| --- | --- | --- |
| 纯 JS 加密（UTF-8/Base64/SHA-1/HMAC-SHA1/RFC3986） | `src/host/crypto.ts` | 完成，标准向量验证 |
| 传统 RPC 签名 | `src/providers/aliyun/signing.ts` | 完成，官方向量 + Go 源码逐字节对拍 |
| RPC 传输（错误分类、预算、重试、边界） | `src/providers/aliyun/rpc.ts` | 完成 |
| 配置解析与严格校验 | `src/config/*.ts` | 完成（simple + 高级 JSON） |
| 领域纯函数 | `src/domain/*.ts` | 完成（usage/history/policy/schedule/timezone/format） |
| 直连数据源 | `src/providers/aliyun/direct.ts` | 完成 |
| 只读采集与缓存 | `src/services/collect.ts`、`cache.ts` | 完成（字段级新鲜度、身份指纹） |
| 服务器数据源 | `src/providers/cdt-server.ts` | 完成（v1 时间戳按不可信处理） |
| 小组件渲染 | `src/widget/*.ts` | 完成（7 family、SVG、全状态降级） |
| 定时采集与通知 | `src/entries/refresh.ts` | 完成 |
| 脱敏诊断 | `src/entries/diagnostics.ts` | 完成 |
| 独立控制路径 | `src/entries/control.ts`、`automation.ts`、`services/control.ts` | 完成，**默认关闭**；开启需显式真机自证（`deviceVerification`） |

---

## 二、阶段门槛对照（按主文档阶段 0–5）

### 阶段 0：核对与能力探针 — 离线完成

- [x] 核对 HEAD 与审查基线：**一致**（`ad152f0`），仅有 `AGENTS.md` 与 `egern/` 未跟踪
- [x] 确认 `docs/architecture-analysis.md` 为 PHP/Vue 旧版描述，未被误用
- [x] 建立子项目、types 与只读诊断入口
- [x] 诊断不读回秘密，只探测 ctx 接口、全局、storage 读写、family、App 版本
- **门槛**：已记录官方支持与待实机项（`docs/compatibility.md`）；已选定「缓存不共享」降级路径 → 达成（离线部分）

### 阶段 1：模型、配置与只读数据源 — 离线完成

- [x] 模型/校验（simple env + 高级 JSON schema）
- [x] 签名固定向量（S01 通过）
- [x] `DirectAliyunProvider` 与 `CdtServerProvider`
- [x] 只读 collector 与字段级新鲜度
- [x] 去重聚合（scope/account 只计一次）
- [x] 错误分类与预算控制
- **门槛**：脱敏 fixture 全通过；widget 依赖图无控制；同账号多实例正确去重；单位/周期待核项清楚 → 达成

### 阶段 2：原生小组件与基础模块 — 离线完成

- [x] 7 个 family 布局
- [x] 浅深色自适应颜色
- [x] 错误 / 旧缓存 / 未配置 / 无历史 / 目标缺失等状态
- [x] SVG 进度与趋势、`refreshAfter`
- [x] 基础 module + env_schema + 单账号示例
- **门槛**：所有正常与异常输出合法 DSL；bundle 自包含；无其他客户端 API；未知 family 不崩溃 → 达成

### 阶段 3：定时采集、历史、账单与通知 — 离线完成

- [x] refresh schedule（`*/15 * * * *`）
- [x] 有限历史（48 小时 / 35 天）与周期降级
- [x] 可选账单（6h TTL、分币种、失败保留旧值）
- [x] 已启用告警与日报（含补偿窗）
- [x] 配置变更缓存失效
- **门槛**：休眠/漏执行下不虚构历史；跨月正确降级；部分失败不变新鲜；通知不会由 widget 外发 → 达成

### 阶段 4：控制增强与服务器可靠自动化 — 离线完成，控制默认关闭

- [x] 独立 `ControlIntent` 校验、policy 纯函数、uncertain 处理
- [x] 未授权 0 动作的离线测试（C02 系列）
- [x] 无法满足存储/授权门槛时降级为控制台导航
- [x] 控制默认关闭，且开启需**显式的真机自证**（`deviceVerification` + `verifiedAt`）
- [ ] **真机验证跨执行意图持久化与同目标串行** — **未执行**（需要设备）
- **门槛**：默认所有控制关闭；离线测试证明未授权 0 动作；真实云动作不用于测试 → 达成
  （控制能力默认关闭，可由用户自证后自行开启；保活定位为"最佳努力"）

### 阶段 5：文档、CI、版本化产物与验收 — 离线完成

- [x] 安装、权限、参数、单位迁移、能力矩阵、故障处理、回退
- [x] 可加载产物 + 版本/来源 commit/SHA-256
- [x] 运行第 17 节必要检查（见 `docs/acceptance.md`）
- [x] 新增 Egern 专用 CI 检查
- **门槛**：离线完成；没有 TODO 占位发布地址；没有空壳核心功能；没有虚假实测记录 → 达成

---

## 三、待实机验证（尚未执行）

1. 模块安装、`env_schema` 默认值与配置修改生效
2. generic 手动预览、桌面与锁屏全部 7 类布局（`systemExtraLarge` 无 iPad 设备）
3. 两个 widget 同脚本不同选择变量、两份 module 不同 namespace 不串视图
4. `schedule → generic`、主 App → widget extension 的 storage 共享探针
5. 网络开关、VPN、前后台、强退、锁屏、低电量、重启后的 cron 行为
6. `refreshAfter` 实际效果、时区正确性
7. 自动控制默认关闭、read 调用 0 动作；控制流程**只在用户另行授权的非生产实例**上验证

逐项步骤见 [compatibility.md](compatibility.md)。

## 四、待云端联调（尚未执行）

`ListCdtInternetTraffic` 的 **单位**、周期/重置时点、合法空数组语义、RAM Action；
ECS `DescribeInstanceStatus` 的 `InstanceId` 传参形式；BSS 分页终止条件；
`StopCharging` 的实际模式字段。完整 12 项清单见
[aliyun-api-contract.md](aliyun-api-contract.md) 第 F 节。

**在完成这些核实之前，本项目不声称用量数值绝对准确，也不声称本地控制可安全执行。**

---

## 五、已知限制（明确不实现 / 不承诺）

- 不实现自动购买、创建/重建、释放实例、修改带宽、真正的 Spot 续租
- 不实现 SMTP 与自定义 SOCKS5（依赖原始 TCP，宿主未提供；留在可选后端）
- 不保证 `refreshAfter` 按时唤醒，也不保证「零超额费用」
- 不承诺手机端自动化在 App 未运行时执行
- 不继承 Go 版本已有的历史数据（独立模式从安装后开始采样）
