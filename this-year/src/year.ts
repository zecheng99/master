export const START = "2026-11-08";
export const END = "2027-11-07";
export const TOTAL = 365;
export function todayInSingapore(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return `${p.find(x => x.type === "year")!.value}-${p.find(x => x.type === "month")!.value}-${p.find(x => x.type === "day")!.value}`;
}
export function countdown(now = new Date()) {
  const today = todayInSingapore(now);
  const day = (s: string) => Date.parse(s + "T00:00:00Z") / 86400000;
  const untilStart = day(START) - day(today);
  const remaining = Math.max(0, Math.min(TOTAL, day(END) - day(today) + 1));
  return { today, remaining, untilStart, elapsed: TOTAL - remaining, ended: today > END, before: today < START };
}
export const seedTitles = [
 "去共青森林公园（最好是骑自行车去）", "去柳州", "去台州", "去贵阳", "去乐山", "去周边城市徒步1日游 - 游侠客", "声乐课上完", "上30节健身课", "跑10公里", "决定学东京8平米，尽量在外面过日子", "不买年——只消耗不购买"
];
export type Wish = { id: string; title: string; target: number | null; progress: number; completed: number; completed_on: string | null; position: number };
export type Photo = { id: string; entry_id: string };
export type Entry = { id: string; wish_id: string; day: string; body: string; photos: Photo[] };
