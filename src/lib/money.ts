// COP currency formatting for evDogs. Exposed to Muten via `use cop from "~/lib/money.ts"`.
const fmt = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export function cop(n: number): string {
  return fmt.format(n || 0);
}
