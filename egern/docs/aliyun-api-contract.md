# 阿里云 API 契约（离线研究记录）

> 研究方式：**离线**阅读官方生成的 SDK 类型定义与公开文档，**未**调用任何真实阿里云接口，**未**使用任何凭据，**未**开停任何实例。
> 研究日期：2026-10-08。仓库源码基线 commit `ad152f04efccf1093e791a8a839d7a3fa64527d1`。
>
> 证据标签（全文强制使用）：
> - **官方契约**：官方生成的 SDK 类型定义或官方文档明确描述的行为，附来源。
> - **源码事实**：本仓库当前实现的行为，附 `文件:行`。
> - **工程决策**：本项目为迁移所做的选择。
> - **待核实**：无法离线确认，必须用只读真实账号验证。**任何一项都不得被当作已确认的平台事实。**
>
> 本文件中的 SDK 结论来自以下官方 npm 包（阿里云官方发布的 OpenAPI 生成产物）：
> `@alicloud/cdt20210813@1.0.1`、`@alicloud/ecs20140526@7.11.6`、`@alicloud/bssopenapi20171214`、`@alicloud/openapi-util@0.3.3`。

---

## A. 端点 / Action 对照表

| 服务/动作 | Version | endpoint 与 RegionId | 必需参数 | 响应包装与解析字段 | 证据 |
| --- | --- | --- | --- | --- | --- |
| CDT `ListCdtInternetTraffic` | `2021-08-13` | `cdt.aliyuncs.com`；`RegionId` 由 SDK 公共参数注入，源码固定传 `cn-hongkong` | 无（唯一可选 `BusinessRegionId`） | 根级 `RequestId` + `TrafficDetails[]` | 官方契约（cdt SDK `client.ts`，`method: "POST"`, `style: "RPC"`, `reqBodyType: "formData"`, `bodyType: "json"`, `protocol: "HTTPS"`, `pathname: "/"`）；源码事实 `internal/aliyun/client.go:76` |
| ECS `DescribeInstanceStatus` | `2014-05-26` | `ecs.<region>.aliyuncs.com`；`RegionId` **必需** | `RegionId` | `InstanceStatuses.InstanceStatus[]` | 官方契约（ecs SDK `DescribeInstanceStatusRequest.ts` 标注 regionId 为 required） |
| ECS `StartInstance` | `2014-05-26` | `ecs.<region>.aliyuncs.com` | `InstanceId` | `RequestId` | 官方契约（SDK `StartInstanceRequest`）；源码事实 `client.go:135` |
| ECS `StopInstance` | `2014-05-26` | `ecs.<region>.aliyuncs.com` | `InstanceId` | `RequestId` | 官方契约（SDK `StopInstanceRequest`）；源码事实 `client.go:135` |
| BSS `QueryAccountBalance` | `2017-12-14` | 中国站 `business.aliyuncs.com` / `cn-hangzhou`；国际站 `business.ap-southeast-1.aliyuncs.com` / `ap-southeast-1` | 无（`RegionId` 由 SDK 公共参数注入） | `Code`/`Success`/`Data.AvailableAmount`(string)/`Data.Currency`(string) | 官方契约（bss SDK `QueryAccountBalanceResponseBody.ts`）；源码事实 `client.go:186-191` |
| BSS `DescribeInstanceBill` | `2017-12-14` | 同上 | `BillingCycle` | `Data.Items[]`、`Data.NextToken`、`Data.MaxResults`、`Data.TotalCount` | 官方契约（bss SDK `DescribeInstanceBillRequest.ts` / `ResponseBody.ts`） |

**工程决策**：迁移保留原 Go 客户端的端点划分，并用上表核对每个动作的必需参数；不引入完整 Node SDK，只按其 wire format 手写 RPC。

---

## B. `ListCdtInternetTraffic` 深入核对（本项目最高优先级的未知项）

这是原项目最关键的接口，官方**没有**可访问的 per-action API 参考页（英文/中文 help 站点的对应 slug 均返回 404 模板页）。因此以官方生成的 SDK 为准。

### B1. 是否存在公开定义

**官方契约**：存在。`@alicloud/cdt20210813@1.0.1` 的 `src/client.ts:284` 定义了
`ListCdtInternetTrafficRequest`，`:1157` 定义了 `listCdtInternetTrafficWithOptions`。

**官方契约**：`@alicloud/cdt20210813` 的调用参数为
`action: "ListCdtInternetTraffic"`、`version: "2021-08-13"`、`protocol: "HTTPS"`、`pathname: "/"`、`method: "POST"`、`authType: "AK"`、`style: "RPC"`、`reqBodyType: "formData"`、`bodyType: "json"`。
这与本仓库手写的传统 RPC POST 表单完全一致，因此**不需要**为它单独改用其他协议。

**源码事实**：`internal/aliyun/client.go:76` 调用
`c.call(ctx, ak, secret, "cn-hongkong", "cdt.aliyuncs.com", "2021-08-13", "ListCdtInternetTraffic", nil)`。

**待核实（原指导文档的说法需要更正）**：指导文档称「本次下载的公开 CDT Go SDK `cdt-20210813` 未包含 `ListCdtInternetTraffic` 定义」。就 **Go** SDK 而言这成立（该模块只含 `GetCdtServiceStatus` / `OpenCdtService` / `GetCdtCbServiceStatus` / `OpenCdtCbService`）；但 **TypeScript 与 Python** 官方 SDK 都定义了它。结论应表述为「Go SDK 未覆盖，TS/Python SDK 覆盖」，而不是「该接口没有公开定义」。

### B2. 请求参数（最重要的结论）

**官方契约**：`ListCdtInternetTrafficRequest` 只有 **一个** 字段：

| 参数 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `BusinessRegionId` | `string` | 否 | 业务地域 |

**官方契约**：**没有** `StartTime`、**没有** `EndTime`、**没有**任何统计周期/时间范围参数，**没有** `PageNumber`/`PageSize` 分页参数。

**工程决策**：因此
1. **绝不添加** `StartTime`/`EndTime`（指导文档明确禁止）；
2. 该接口返回的是**服务端自行决定的累计口径**，本项目不得声称它是「本月」或任何具体窗口；
3. 快照中该 scope 的 `periodId` 记为 `unverified`（见 `src/domain/models.ts` 的 `UNVERIFIED_PERIOD`），UI 标注「接口累计（统计周期待确认）」，历史样本只画累计曲线、不做「小时消耗」标注（见 `src/domain/history.ts`）。

**源码事实**：`internal/aliyun/client.go:76` 传 `nil` extras，即不传 `BusinessRegionId`。即原项目调用时依赖服务端默认口径。

### B3. 响应结构

**官方契约**（cdt SDK `client.ts:303`、`:886`）：

```text
ResponseBody
  RequestId: string
  TrafficDetails: [
    {
      BusinessRegionId: string
      ISPType: string
      Traffic: number
      ProductTrafficDetails: [ { Product: string, Traffic: number } ]
      TrafficTierDetails:    [ { Tier: number, LowestTraffic: number, HighestTraffic: number, Traffic: number } ]
    }
  ]
```

要点：
- **官方契约**：`TrafficDetails` 位于**响应根级**，不是包在 `Data` 里。
- **源码事实**：`internal/aliyun/client.go:325-355` 的 `trafficFromResponse` 同时尝试根级 `TrafficDetails` 与 `Data.TrafficDetails`，并对 `{ "Item": ... }` 做包装兼容（`asSlice`）。兼容性保留是安全的。
- **官方契约**：`Traffic` 为 `number`（SDK 未声明单位）。
- **官方契约**：存在 `ISPType`、`ProductTrafficDetails`、`TrafficTierDetails` 等**原项目完全忽略**的维度。

**工程决策**：迁移解析时保留这些字段的原始形态但不据此聚合（原项目只按 `BusinessRegionId` 聚合）。若将来要按 ISP/产品细分，属于**新增功能**，需单独立项，不得混入本次迁移。

### B4. `Traffic` 的单位 —— 本项目最大的未确认项

**待核实**：官方 SDK 只声明 `Traffic: number`，**没有**任何单位标注；可访问的官方页面也没有说明。

**源码事实**：`internal/aliyun/client.go:346` 做 `total / (1024*1024*1024)`，即**假定** `Traffic` 的单位是字节，并换算成 GiB；而界面（`web/src/types.ts`、`internal/domain/models.go` 的 `flow_total`）把它标成 **GB**。这是一个单位标注错误：即使假定成立，1024³ 是 GiB 而非 GB（差约 7.4%）。

**工程决策**：
- provider 内部**一律保留原始字节数**，并显式记录 `sourceUnit`（`bytes` / `legacyGiB`）；
- 比较阈值前把配额统一折算成字节（`src/domain/usage.ts` 的 `quotaToBytes`），显示时最后才换算；
- 从 Go 服务端 v1 接口导入的 `flow_used`/`flow_total` 按**现有行为**视为 **GiB**，标记 `sourceUnit: "legacyGiB"`，绝不把数字原样改标为 GB。

**待核实（必须用只读真实账号验证）**：`Traffic` 究竟是
(a) 字节、(b) GiB、(c) GB、还是 (d) 已扣免费额度后的计费量。
判据建议：同账号在云监控/CDT 控制台读到的当月海外用量与接口值直接对比；若数值量级相差 10^9 或 2^30，即可确定单位。**在确认之前，本项目不得宣称用量数值绝对准确，只保证按原始值展示与比较。**

### B5. 分页与「合法空数组」

**官方契约**：请求模型无分页参数，响应模型无 `TotalCount` / `NextToken`，故该接口**不分页**。

**待核实**：**合法空数组**（账号确实无流量）与**异常响应**（字段缺失）如何区分。

**源码事实**：`client.go:259-261` 把空 `TrafficDetails` 当作**错误**并重试（`TestGetTrafficRetriesEmptyTrafficDetails` 固化了这一行为）；`client.go:332` 再次返回错误。

**工程决策（重要，与源码不同）**：指导文档要求区分二者：
- 响应中**存在** `TrafficDetails` 字段且为**空数组** → 视为已确认的 `0`；
- 响应中**缺少** `TrafficDetails` 字段 / 结构不可识别 → 视为**未知**，保留上一次成功值并标注错误，**不**因此解除阈值保护。
由于 B5 未核实，本项目默认把空数组记为「待确认的 0」并附质量标记，而**不会**用它解除保护闩锁（见 `src/domain/policy.ts`）。

### B6. RAM 权限

**待核实**：官方未提供该动作的 RAM Action 字符串与资源粒度。按阿里云 RPC 惯例，只读授权形如 `cdt:ListCdtInternetTraffic`，但**未获确认**。
**工程决策**：安装文档中把它列为「需用户在 RAM 中确认」，并明确**不要求** `AdministratorAccess`。不编造资源 ARN。

### B7. 统计周期与时区

**待核实**：官方页面与 SDK 均未说明该接口的结算周期、重置时点与所用时区。
**工程决策**：`periodId = "unverified"`；界面显示「接口累计」；日报不声称「本月」；不按本地月份擅自分段或重置（见 `src/domain/history.ts` 的 `computeConsumption`）。**手机的月初到来不等于云端累计已重置。**

---

## C. ECS

### C1. `DescribeInstanceStatus` 的筛选与分页

**官方契约**（ecs SDK `DescribeInstanceStatusRequest.ts`）：

| 参数 | 类型 | 必需 | 备注 |
| --- | --- | --- | --- |
| `RegionId` | string | **是** | |
| `InstanceId` | **string[]** | 否 | 实例 ID 数组，长度 1–100 |
| `PageNumber` | number | 否 | 默认 1 |
| `PageSize` | number | 否 | 1–50，**默认 10** |
| `ZoneId` / `ClusterId` / `Owner*` | — | 否 | `ClusterId` 已废弃 |

**官方契约**：SDK 把 `InstanceId` 作为**数组**写入 query；`@alicloud/openapi-util@0.3.3` 的 `replaceRepeatList` 生成 `InstanceId.1=<id>`、`InstanceId.2=<id>` 形式的重复参数。

**源码事实**：`internal/aliyun/client.go:98-102` 传的是**标量** `params["InstanceId"] = account.InstanceID`（不含 `.1` 后缀）。

**待核实**：服务端是否同时接受 `InstanceId=<id>` 与 `InstanceId.1=<id>`。原 Go 实现按标量形式在线上运行，因此标量很可能可用；但官方 SDK 的规范形式是 `InstanceId.1`。
**工程决策**：
- 发送时沿用源码**已验证在用的标量形式**（不改变现有可用行为）；
- **无论过滤是否生效，都按 `InstanceId` 精确匹配返回项**，绝不用 `results[0]`（见 `src/providers/aliyun/ecs.ts`）；
- 未匹配到目标实例时返回 `Unknown` 并给出原因，而不是猜一个状态；
- 把「标量 vs `InstanceId.1`」列入待核实清单。

**源码事实（缺陷）**：`client.go:106-118` 取 `statuses[0]`，即**返回列表的第一个实例**。当请求未按实例过滤（或分页默认 10 条）时，这会把**别的实例**的状态当成目标实例的状态。迁移必须修正。

**官方契约**：`PageSize` 默认 10、最大 50，故「按地域列出全部实例」需要分页；只查单实例时应在请求中带 `InstanceId` 以减少依赖分页。

### C2. 实例状态枚举

**官方契约 / 源码事实**：`InstanceStatuses.InstanceStatus[].Status` 取值为 `Pending`、`Starting`、`Running`、`Stopping`、`Stopped`（本项目 `src/domain/models.ts` 的 `InstanceStatus` 另加 `Unknown` 表示「未观测到」，与 `Stopped` 严格区分）。

### C3. `StopInstance` 的停机模式

**官方契约**：`StopInstanceRequest` 含 `InstanceId`（必需）、`StoppedMode`（string）、`ForceStop`、`DryRun`、`ConfirmStop`（已废弃）。
**官方契约**（SDK 文档注释）：`StoppedMode=KeepCharging` 表示**普通停机**——停机后**继续计费**，并保留实例规格库存与公网 IP。未设置时由账号/实例的「经济模式」设置决定。
**官方契约**（SDK 文档注释）：调用是**异步**的；成功后实例先进入 `Stopping`，需再用 `DescribeInstanceStatus` 查询，**返回 `Stopped` 才算真正停机完成**。

**工程决策**：
- 默认 `KeepCharging`（与源码一致）；
- `StopCharging` 为**显式**经济停机选项，并明确告知用户「请求 `StopCharging` ≠ 已进入经济停机」；
- 动作状态建模为 `pending → accepted → confirmed`，异常为 `uncertain`/`failed`（`src/domain/models.ts` 的 `ActionState`）。**受理成功只显示「已发送/停止中」，查询到 `Stopped` 才显示已停止。**

**待核实**：`StopCharging` 被服务端接受后，用哪个 `DescribeInstances` 字段可以**确认**实例确实处于经济停机（而非静默回退为普通停机）。在确认之前，本项目**不显示**「已进入经济停机」，只显示「已请求」。

---

## D. BSS

### D1. `QueryAccountBalance`

**官方契约**：响应体 `Code`、`Message`、`RequestId`、`Success`，以及
`Data{ AvailableAmount, AvailableCashAmount, CreditAmount, Currency, MybankCreditAmount, QuotaLimit }`，其中 `AvailableAmount` 与 `Currency` 都是 **string**。

**源码事实**：`client.go:152-156` 读 `Data.AvailableAmount`（字符串转数字）与 `Data.Currency`，币种为空时默认 `CNY`。`TestGetAccountBalanceAcceptsAliyunBusinessCode200` 固化了「HTTP 200 + `Code="200"` 视为成功」。

**官方契约**：成功码并非常见的 `OK`，BSS 用 `Code="200"` 或 `Success=true`。因此**不能只看 HTTP 状态码**判定成功。

**工程决策**：`Code` 的 `OK` / `200` / `Success` / `success` 以及 `Success===true` 均视为成功；其他值按业务错误处理并保留上一次成功值。

### D2. `DescribeInstanceBill`

**官方契约**：请求含 `BillingCycle`（**必需**，格式 `YYYY-MM`）、`Granularity`（`MONTHLY`/`DAILY`）、`InstanceID`（注意大写 `ID`）、`MaxResults`、`NextToken`、`ProductCode`、`SubscriptionType`、`IsBillingItem` 等。

**官方契约**：响应 `Data{ AccountID, AccountName, BillingCycle, Items[], MaxResults, NextToken, TotalCount }`。
**官方契约**：`Items` 是**扁平数组**；每个 item 含 `PretaxAmount`(number)、`PretaxGrossAmount`、`PaymentAmount`、`Currency`、`InstanceID`、`BillingDate`、`SubscriptionType` 等。

**源码事实（缺陷）**：`client.go:163-182` 只取**第一页**并对 `PretaxAmount` 求和，**没有**跟随 `NextToken`。当一个月内同一实例的账单明细超过单页上限时，求和结果**偏小**，但代码把它当成完整账单。

**工程决策**：
- 迁移时**跟随 `NextToken` 取全**，并设置页数上限与总时间预算；达到上限时把结果标记为 **partial**，不声称完整；
- 金额按 `Currency` 分组，**不做汇率换算**（`src/domain/usage.ts` 的 `sumByCurrency`）；
- 实例账单只代表该实例的实账，**不得**称为 CDT 专项费用、总云费用或流量估算；
- 缓存 6 小时，失败保留上次成功值与真实时间。

**待核实**：`MaxResults` 的服务端默认值与上限；`NextToken` 的有效期与是否需要重复同一 `BillingCycle`。

---

## E. 传统 RPC 签名（`SignatureVersion=1.0`，HMAC-SHA1）

### E1. 算法步骤（**官方契约** + 源码事实一致）

1. 合并公共参数与业务参数，**排除** `Signature`，按键名 **ASCII 升序**排序。
2. 对键和值做 **RFC 3986** percent-encode（UTF-8）：空格 → `%20`，`*` → `%2A`，`~` **保留不编码**，`!'()*` **要编码**（这是与 JS `encodeURIComponent` 的关键差异）。
3. 拼接 `CanonicalizedQueryString`，再构造 `METHOD&%2F&percentEncode(canonical)`。
4. 签名 key 为 `AccessKeySecret + "&"`，HMAC-SHA1 取二进制摘要，Base64 后再表单编码。
5. `Timestamp` 用 UTC `YYYY-MM-DDTHH:mm:ssZ`；每次请求/重试**重新生成** nonce 与时间戳。
6. 使用 `application/x-www-form-urlencoded` 字符串 POST 到 HTTPS 根路径。

**源码事实**：`client.go:287-315` 与上述一致，但 `client.go:304` **硬编码** `"POST&%2F&"`，与实际 HTTP 方法无关（原客户端只发 POST，因此线上自洽）。

### E2. 官方固定向量（**已独立复算通过**）

| 项 | 值 |
| --- | --- |
| method | `GET` |
| Action | `DescribeDedicatedHosts` |
| AccessKeyId | `testid` |
| AccessKeySecret | `testsecret` |
| RegionId | `cn-beijing` |
| Version | `2014-05-26` |
| Format | `JSON` |
| SignatureMethod | `HMAC-SHA1` |
| SignatureVersion | `1.0` |
| Timestamp | `2023-03-13T08:34:30Z` |
| SignatureNonce | `edb2b34af0af9a6d14deaf7c1a5315eb` |
| **期望 Signature** | **`9NaGiOspFP5UPcwX8Iwt2YJXXuk=`** |

**官方契约**：本项目用两套独立实现（Python 参考实现、以及本仓库的 TypeScript 实现）复算，均得到 `9NaGiOspFP5UPcwX8Iwt2YJXXuk=`。

CanonicalizedQueryString 为：

```text
AccessKeyId=testid&Action=DescribeDedicatedHosts&Format=JSON&RegionId=cn-beijing&SignatureMethod=HMAC-SHA1&SignatureNonce=edb2b34af0af9a6d14deaf7c1a5315eb&SignatureVersion=1.0&Timestamp=2023-03-13T08%3A34%3A30Z&Version=2014-05-26
```

**工程决策**：同一参数集改用 **POST** 时签名为 `ZvQ9xGiFnquSJRvj+WE6kdSpTwU=`——**与上述 GET 值不同**。本项目把 HTTP 方法作为签名的**显式参数**（`src/providers/aliyun/signing.ts` 的 `signParams`），而不是复制源码的硬编码 `POST`。`tests/signing.test.ts` 同时锁定 GET（官方向量）与 POST（与 Go 源码逐字节对拍）。

### E3. V2 与 V3

**官方契约**：阿里云当前文档建议 V3，传统 V2 标为不推荐/已过时。
**官方契约**：`@alicloud/cdt20210813` 的 `listCdtInternetTraffic` 使用 `style: "RPC"`，由 SDK 按 AK 签名（对应传统 RPC 签名语义）。
**工程决策**：本次迁移**先**建立与源码一致的传统签名兼容层（已通过固定向量与 Go 对拍），V3 作为**单独的**签名策略在未来核实后再引入；**不**在未经验证的情况下全量切 V3，也不假设内部 CDT 动作支持 V3。

---

## F. 待核实清单（必须用只读真实账号验证）

1. **`ListCdtInternetTraffic.Traffic` 的单位**：字节 / GiB / GB / 已扣免费额度后的计费量？与云监控控制台数值对比即可判定。（**最高优先级**）
2. `ListCdtInternetTraffic` 返回的累计口径与**重置时点/时区**；是否为自然月、按 UTC 还是 UTC+8 重置。
3. 该接口**合法空数组**（账号确无流量）与**字段缺失**的差异；是否存在 `Code`/`RequestId` 之外的成功标记。
4. 该接口的 **RAM Action 字符串**与资源粒度（是否必须 `Resource: "*"`）。
5. `ListCdtInternetTraffic` 不传 `BusinessRegionId` 时的默认范围；传该参数后范围如何变化。
6. ECS `DescribeInstanceStatus` 接受**标量** `InstanceId=i-xxx` 还是必须 `InstanceId.1=i-xxx`；两者是否都可过滤。
7. `DescribeInstanceStatus` 在该地域实例数 > `PageSize`（默认 10）时的分页行为；只传 `InstanceId` 时是否仍受分页影响。
8. `StopCharging` 被受理后，用哪个 `DescribeInstances` 字段**确认**已进入经济停机；是否存在静默回退为普通停机的情况。
9. BSS `DescribeInstanceBill` 的 `MaxResults` 默认值/上限，以及 `NextToken` 的翻页终止条件（`NextToken` 为空还是 `TotalCount` 用尽）。
10. `QueryAccountBalance` 在**国际站**返回的 `Currency` 取值集合；`Code="200"` 之外的其它成功码是否存在。
11. 传统签名（V2）对上述各动作是否**全部**仍然被接受；是否存在已强制 V3 的动作。
12. CDT 服务是否已在目标账号/地域开通；未开通时的错误码与提示文案。

---

## 与源码基线的差异汇总（供迁移核对）

| 项 | 源码行为 | 目标行为 | 位置 |
| --- | --- | --- | --- |
| 签名 HTTP 方法 | 硬编码 `POST` | 方法作为显式参数（GET 向量可验） | `src/providers/aliyun/signing.ts` |
| 单位 | 除以 1024³ 却标 GB | 保留原始 bytes，显式 `GB`/`GiB` | `src/domain/usage.ts` |
| 百分比比较 | 先 round(2) 再比较 | 原始值比较，仅显示时取整 | `src/domain/usage.ts` |
| ECS 实例匹配 | 取 `results[0]` | 按 `InstanceId` 精确匹配，否则 `Unknown` | `src/providers/aliyun/ecs.ts` |
| 空 `TrafficDetails` | 一律视为错误并重试 | 区分「已确认空数组=0」与「字段缺失=未知」 | `src/providers/aliyun/traffic.ts` |
| BSS 账单 | 只取第一页 | 跟随 `NextToken` 取全，超预算标 partial | `src/providers/aliyun/billing.ts` |
| 统计周期 | 隐含视为当月 | `periodId="unverified"`，不擅自分段 | `src/domain/history.ts` |
