# CDT Monitor for Egern

用 Egern 监控阿里云 CDT 流量与 ECS 实例状态，并在 iOS 桌面与锁屏显示原生小组件。

本子包是 [CDT-Monitor](../README.MD) 的 Egern 实现：**默认无需自建服务器**，直接在手机端
用只读 RAM 凭据调用阿里云接口。已有的 Go 后端仍可作为可选的只读数据源保留。

> **实现状态**：离线实现与离线验证已完成（类型检查、182 项测试、构建、模块与产物校验全部通过）。
> **Egern / iOS 实机验证与真实云账号联调尚未执行**——详见
> [兼容性记录](docs/compatibility.md) 与 [实现状态](docs/implementation-status.md)。

---

## 快速开始（普通用户路径）

### 1. 准备只读凭据

在阿里云 RAM 中创建一个**只读**用户，只授予：

- CDT 查询（`ListCdtInternetTraffic`）
- 可选：目标 ECS 实例的状态查询
- 可选：BSS 余额与账单查询

不要使用主账号 AccessKey，不要授予 `AdministratorAccess`。具体 Action 字符串与资源粒度
仍需按 [接口契约](docs/aliyun-api-contract.md) 的待核实项在你的账号上确认。

### 2. 添加模块

在 Egern 的 **工具 → 模块** 中新增：

```text
https://raw.githubusercontent.com/Seameee/CDT-Monitor/main/egern/dist/cdt-monitor.yaml
```

> 上面是**本仓库**（`Seameee/CDT-Monitor`）的地址，由构建时依据 `origin` 远端生成。
> 如果你把代码放到了别处，请替换成你自己的仓库地址；
> 实际发布地址与校验和记录在 `dist/manifest.json` 中。

### 3. 填写 Env

在模块编辑页填入：

| 变量 | 说明 |
| --- | --- |
| `CDT_ACCESS_KEY_ID` | 只读 RAM 的 AccessKey ID |
| `CDT_ACCESS_KEY_SECRET` | 只读 RAM 的 AccessKey Secret（只保存在你的 Egern 配置里） |
| `CDT_INSTANCE_ID` | 可选，`i-xxxx`；填写后才会查询该实例状态 |
| `CDT_QUOTA` | **你自己确认过的**本周期上限，例如 `200`；留空则只显示用量 |
| `CDT_QUOTA_UNIT` | `GB`（10⁹ 字节）或 `GiB`（2³⁰ 字节），二者相差约 7.4% |

**不填写 `CDT_QUOTA` 时**，小组件只显示真实用量，剩余与百分比显示为「未配置」——
不会用 0 或默认 200 假装成你的免费额度。

### 4. 添加小组件

在 Egern 的 **Analytics** 页打开小组件库预览数据，确认流量范围与单位无误后：

- 桌面：长按空白处 → `+` → 搜索 Egern → 选择尺寸 → 长按小组件 → 编辑小组件 → 选择
  `CDT Monitor main`；
- 锁屏：按对应 family（圆形 / 矩形 / 单行）添加。

### 5. 按需开启通知

阈值通知**默认关闭**。需要时把 `CDT_LOCAL_NOTIFY` 设为 `true`。
小组件渲染本身永远不会发送通知。

---

## 数据口径（务必先读）

| 事项 | 说明 |
| --- | --- |
| **流量是账号范围的** | `ListCdtInternetTraffic` 返回的是**账号 CDT 累计**，不是单台 ECS 的流量，也不是本机代理统计。实例只与某个流量范围相关联。 |
| **统计周期未确认** | 该接口没有任何周期参数，官方也没说明重置时点。因此界面标注「接口累计（统计周期待确认）」，**不会**声称是「本月」。 |
| **单位待核实** | 官方未声明 `Traffic` 的单位。本插件按字节处理并如实标注；在你自己账号上核对前，请勿把数值当作绝对精确值。 |
| **GB ≠ GiB** | `GB` 是 10⁹ 字节，`GiB` 是 2³⁰ 字节。界面永远带单位后缀，不会混用。 |
| **国内 / 海外** | `cn-*`（**香港除外**）为国内，其余为海外。这与「中国站 / 国际站」是**两个独立概念**——站点只决定 BSS 端点与币种。 |
| **多个实例共享额度** | 同一流量范围下多台实例的用量与额度**只计一次**；实例行只显示状态，不重复画额度。 |
| **阈值比较用原始值** | 显示会四舍五入，但判断阈值用未取整的原始比例，所以「显示 95.00%」不等于一定触发。 |

---

## 高级配置

### 多账号（`CDT_ACCOUNTS_JSON`）

设置该项后，简单模式的 `CDT_ACCESS_KEY_*` 会被**忽略**（不是合并），以避免同一账号被重复计数。

- 单账号示例：[examples/single-account.example.json](examples/single-account.example.json)
- 多账号示例：[examples/multi-account.example.json](examples/multi-account.example.json)

要点：

- 同一个阿里云账号的多个 AK，必须显式归到同一个 `accountId`；
- 余额按 **account** 只计一次，用量按**流量范围**只计一次；
- CNY 与 USD **分开合计**，不自动换汇；
- `schemaVersion` 不匹配会被**拒绝**，不会回退到另一套账号配置。

### 多个小组件视图

视图选择变量 `CDT_SCOPE_ID` / `CDT_INSTANCE_IDS` / `CDT_THEME` 必须写在 **widget 的 env** 里。
写进模块 env 会覆盖所有视图。示例见
[examples/multiple-widgets.example.yaml](examples/multiple-widgets.example.yaml)。

优先级为 **Module > Widget > Script**。

### 服务器模式

如果已经运行 CDT-Monitor Go 服务，可以改用
`dist/cdt-monitor-server.yaml`，只需 `CDT_BASE_URL` 与 `CDT_READ_TOKEN`
（`widget:read` 权限），不需要云凭据。

**v1 新鲜度限制（重要）**：Go v1 接口返回的 `updated_at` / `last_updated` 是**入队时间**，
也会被控制动作和成功查询刷新，**不是云端采样时间**。因此：

- 界面显示为「服务器记录更新于…」，并标注可能陈旧；
- 该数据**不能**作为本地自动控制的新鲜度依据（代码层面已阻止）；
- `flow_used` / `flow_total` 实际按 **GiB** 存储但被标为 GB，本插件按 GiB 换算成字节再比较。

### 实例开关机（默认关闭）

本地启停**默认完全关闭**，并且需要先在真机证明两个前提（跨执行意图持久化、同目标串行执行）。
在此之前：

- `cdt-control.js` 只校验意图并给出拒绝原因，**不执行任何云写操作**；
- `cdt-automation.js` 只评估策略、发送通知，并记录被扣下的动作；
- 请通过云控制台完成启停。

启用步骤与限制见 [兼容性记录](docs/compatibility.md) 第 3 节。

---

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 小组件空白 / 显示「尚未配置」 | 未填 `CDT_ACCESS_KEY_ID`/`SECRET`，或 `CDT_MODE` 与模块不匹配 |
| 显示「凭据无效或权限不足」 | AccessKey 被撤销、STS Token 过期，或 RAM 缺少 CDT/BSS 权限 |
| 显示「数据可能已过期」 | 上一次采集失败，当前展示的是缓存值；检查网络与权限 |
| 显示「未找到目标实例」 | `CDT_INSTANCE_ID` 不属于该地域，或该 RAM 没有 ECS 查询权限 |
| 百分比显示「—」 | 未配置 `CDT_QUOTA`，或单位/数值不合法（这是**有意**的，不会编造数字） |
| 账单永远「未启用」 | `CDT_BILLING_ENABLED` 默认 `false`；开启后余额与账单各自缓存 6 小时 |
| 模块 env 覆盖了 widget 设置 | 这是文档规定的优先级（Module > Widget）；视图变量不要写进模块 env |
| 签名错误 / 时间戳错误 | 脚本每次请求都会重新生成 nonce 与时间戳；持续失败请检查设备时间是否准确 |
| 同一 Profile 装了两份模块名称冲突 | 给其中一份设置不同的 `MODULE_ID`（只允许字母、数字、`_`、`-`） |

完整故障清单与能力边界见 [兼容性记录](docs/compatibility.md)。

---

## 开发

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check:modules
npm run check:bundles
```

- Node **仅用于开发、构建与测试**，不是 Egern 的运行时依赖；
- 构建使用 esbuild 的 `platform: "neutral"` + `format: "esm"`，每个入口一个自包含 bundle；
- `dist/` 是生成产物，但**需要提交**：模块里的 `script_url` 指向对应 commit 的
  `dist/` 文件，只有提交后该地址才可解析。

目录与架构说明见 [egern/AGENTS.MD](AGENTS.MD)；接口契约见
[docs/aliyun-api-contract.md](docs/aliyun-api-contract.md)。

## 安全

- 只用**只读** RAM 凭据；控制凭据与监控凭据分开；
- 秘密只放在本地 Egern env，**不要**写进 YAML、截图、Issue 或安装链接；
- 本项目**不**抓取网页登录 Cookie，**不**要求 MITM、DNS 改写或安装 CA；
- 小组件的点击链接只做 GET 跳转，链接里不含任何密钥或执行动作；
- 分享配置或截图前，请先移除 Env 中的凭据。

## License

MIT，原作者署名见仓库根目录 [LICENSE](../LICENSE)。
