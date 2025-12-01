export function formatZecAmount(amount: number): string {
  if (!Number.isFinite(amount)) return '0';
  if (amount >= 1) return amount.toFixed(4).replace(/\.0+$/, '');
  const str = amount.toFixed(8);
  return str.replace(/0+$/, '').replace(/\.$/, '') || '0';
}
