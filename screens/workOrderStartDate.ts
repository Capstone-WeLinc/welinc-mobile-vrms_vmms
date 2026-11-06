export function isWorkOrderStartDateReached(
  startDate: string | null,
  now = new Date(),
): boolean {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return false;
  const day = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return startDate <= day;
}
