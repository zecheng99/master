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
 "去共青森林公园（最好是骑自行车去）", "去柳州", "去台州", "去贵阳", "去乐山", "去周边城市徒步1日游 - 游侠客", "上15节声乐课", "上30节健身课", "跑10公里", "决定学东京8平米，尽量在外面过日子", "不买年——只消耗不购买"
];
export type Wish = { id: string; title: string; target: number | null; progress: number; completed: number; completed_on: string | null; position: number; category?: Category | null; pinned?: number };
export type Photo = { id: string; entry_id: string };
export type Entry = { id: string; wish_id: string; day: string; body: string; photos: Photo[] };

export const CATEGORIES = ['旅行与户外', '学习与成长', '运动与健康', '日常生活'] as const;
export type Category = typeof CATEGORIES[number];
// Stored category values remain stable for existing records and backups.
const CATEGORY_LABELS: Record<Category,string> = {
 '旅行与户外': '出去走走',
 '学习与成长': '学点新的',
 '运动与健康': '运动一下',
 '日常生活': '做个实验',
};
export function categoryLabel(category: Category) { return CATEGORY_LABELS[category]; }
export const MAX_PINNED = 7;
export function inferCategory(title: string): Category {
 if (/去|游|公园|旅行|徒步/.test(title)) return '旅行与户外';
 if (/健身|跑|运动/.test(title)) return '运动与健康';
 if (/东京8平米|不买/.test(title)) return '日常生活';
 if (/课|声乐|学习|学/.test(title)) return '学习与成长';
 return '日常生活';
}
export function getCategory(wish: Pick<Wish,'title'|'category'>): Category {
 return CATEGORIES.includes(wish.category as Category) ? wish.category as Category : inferCategory(wish.title);
}
export function isInProgress(wish: Wish) {
 return !wish.completed && !!wish.target && wish.progress > 0 && wish.progress < wish.target;
}
export function canPin(wish: Wish) { return !wish.completed && !isInProgress(wish); }
export function homeSections(wishes: Wish[]) {
 return {
  pinned: wishes.filter(w => !!w.pinned && canPin(w)).slice(0, MAX_PINNED),
  ongoing: wishes.filter(isInProgress),
 };
}
export function groupWishes(wishes: Wish[]) {
 return CATEGORIES.map(category => ({category, wishes: wishes.filter(w => getCategory(w) === category)})).filter(g => g.wishes.length);
}
export function wishUnit(title: string) { return /课/.test(title) ? '节' : '次'; }
