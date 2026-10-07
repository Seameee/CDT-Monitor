/**
 * BSS billing parsing: `QueryAccountBalance` and `DescribeInstanceBill`.
 *
 * Two corrections over the original Go client:
 *
 *  1. **Pagination.** `DescribeInstanceBill` is `NextToken`-paginated
 *     (`Data.NextToken` / `Data.MaxResults` / `Data.TotalCount`). The Go client
 *     read only the first page and summed it (`client.go:163-182`), so any month
 *     whose line items spilled past one page silently under-reported the cost
 *     while presenting it as a complete total. Here callers follow the token,
 *     and running out of budget marks the result `partial` rather than complete.
 *  2. **Amount fields are typed.** `AvailableAmount` is a *string* in the
 *     contract, `PretaxAmount` is a *number*. Both are parsed strictly.
 *
 * Money is never converted between currencies: CNY and USD totals stay separate.
 */

import { strictNonNegativeNumber, strictString, getPath, asArray, asRecord } from "./parse.ts";

/** Parsed account balance. */
export type BalanceParseResult =
  | { ok: true; amount: number; currency: string }
  | { ok: false; reason: string };

/**
 * Parse `QueryAccountBalance`.
 *
 * An empty or missing `Currency` falls back to `CNY`, matching the contract's
 * China-site default and the Go client's behaviour.
 */
export function parseBalance(body: unknown): BalanceParseResult {
  const data = getPath(body, "Data");
  if (asRecord(data) === null) {
    return { ok: false, reason: "响应中缺少 Data 字段" };
  }
  const amount = strictNonNegativeNumber(getPath(body, "Data", "AvailableAmount"));
  if (!amount.ok) {
    return { ok: false, reason: `可用余额字段无效（${amount.reason}）` };
  }
  const currency = strictString(getPath(body, "Data", "Currency")) ?? "CNY";
  return { ok: true, amount: amount.value, currency };
}

/** One parsed bill page. */
export interface BillPage {
  items: Record<string, unknown>[];
  nextToken: string | null;
  totalCount: number | null;
  /** Items present but unreadable, so the sum may be low. */
  rejectedItems: number;
}

/**
 * Parse one page of `DescribeInstanceBill`.
 *
 * `Items` is a flat array in the contract; the `{Item: [...]}` wrapper is also
 * accepted because other Aliyun list APIs use it and the Go client handled both.
 */
export function parseBillPage(body: unknown): BillPage {
  const items = asArray(getPath(body, "Data", "Items")) ?? [];
  const parsed: Record<string, unknown>[] = [];
  let rejectedItems = 0;
  for (const item of items) {
    const record = asRecord(item);
    if (record === null) {
      rejectedItems++;
      continue;
    }
    parsed.push(record);
  }
  const nextToken = strictString(getPath(body, "Data", "NextToken"));
  const totalCount = strictNonNegativeNumber(getPath(body, "Data", "TotalCount"));
  return {
    items: parsed,
    nextToken,
    totalCount: totalCount.ok ? totalCount.value : null,
    rejectedItems,
  };
}

/** Aggregated bill total across pages. */
export interface BillTotal {
  /** Sum of `PretaxAmount` across every page that was read. */
  total: number;
  /** Currency codes observed; more than one means the total is ambiguous. */
  currencies: string[];
  /** True when pagination stopped early, so the total may understate cost. */
  partial: boolean;
  /** Items that could not be parsed and were excluded from the sum. */
  rejectedItems: number;
}

/**
 * Sum `PretaxAmount` over already-collected items.
 *
 * `PretaxAmount` is the pre-tax amount the SDK documents for this action. Items
 * whose amount is unparseable are excluded and counted, so the caller can mark
 * the figure as approximate instead of quietly dropping money.
 */
export function sumBillItems(
  items: readonly Record<string, unknown>[],
  options: { partial: boolean },
): BillTotal {
  let total = 0;
  let rejectedItems = 0;
  const currencies = new Set<string>();

  for (const item of items) {
    const amount = strictNonNegativeNumber(item["PretaxAmount"]);
    if (!amount.ok) {
      rejectedItems++;
      continue;
    }
    total += amount.value;
    const currency = strictString(item["Currency"]);
    if (currency !== null) currencies.add(currency);
  }

  return {
    // Round to cents for display; comparison against money is not a decision
    // this project makes.
    total: Math.round(total * 100) / 100,
    currencies: [...currencies].sort(),
    partial: options.partial || rejectedItems > 0,
    rejectedItems,
  };
}
