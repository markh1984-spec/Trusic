/**
 * Money in Trusic is always an integer number of minor units (pence, cents).
 * Never use floats for amounts: every split goes through `allocate`, which
 * hands out every last penny so the books always balance.
 */
export type Minor = number;

export function assertMinor(amount: number, what = "amount"): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`${what} must be a non-negative integer of minor units, got ${amount}`);
  }
}

/**
 * Split `total` across `weights` exactly, using the largest-remainder method.
 *
 * - The result always sums to `total`.
 * - Each share is within one minor unit of its exact proportional value.
 * - Ties go to the earliest index, so the same input always gives the same output.
 *
 * Weights must be non-negative integers and at least one must be positive.
 * BigInt is used internally because `total * weight` can exceed 2^53.
 */
export function allocate(total: Minor, weights: readonly number[]): Minor[] {
  assertMinor(total, "total");
  if (weights.length === 0) throw new RangeError("allocate needs at least one weight");

  const w = weights.map((x, i) => {
    if (!Number.isSafeInteger(x) || x < 0) {
      throw new RangeError(`weight[${i}] must be a non-negative integer, got ${x}`);
    }
    return BigInt(x);
  });
  const sum = w.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new RangeError("allocate needs at least one positive weight");

  const t = BigInt(total);
  const shares = w.map((x) => (t * x) / sum);
  const remainders = w.map((x) => (t * x) % sum);

  let left = t - shares.reduce((a, b) => a + b, 0n);
  const order = w
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = remainders[a]!;
      const rb = remainders[b]!;
      if (ra !== rb) return ra > rb ? -1 : 1;
      return a - b;
    });
  for (const i of order) {
    if (left === 0n) break;
    shares[i]! += 1n;
    left -= 1n;
  }
  return shares.map((x) => Number(x));
}

export function sum(values: readonly number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

export function formatMoney(amount: Minor, currency: string, locale = "en-GB"): string {
  const fmt = new Intl.NumberFormat(locale, { style: "currency", currency });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  return fmt.format(amount / 10 ** digits);
}
