// src/utils/dailyNotePathBuilder.ts
export function buildDailyNotePath(pathRaw: string, date: Date = new Date()): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  if (!pathRaw) return `${year}-${month}-${day}`;

  const today = `${year}-${month}-${day}`;

  return pathRaw
    .replace(/YYYY/g, year)
    .replace(/MM/g, month)
    .replace(/DD/g, day)
    .replace(/YYYY-MM-DD/g, today);
}