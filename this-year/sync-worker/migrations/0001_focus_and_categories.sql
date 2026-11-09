-- Additive migration: existing IDs, progress, journals and photos remain intact.
ALTER TABLE wishes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1));
ALTER TABLE wishes ADD COLUMN category TEXT;
CREATE INDEX wish_owner_pinned ON wishes(owner,pinned);
UPDATE wishes SET category = CASE
 WHEN title LIKE '%去%' OR title LIKE '%游%' OR title LIKE '%公园%' OR title LIKE '%旅行%' OR title LIKE '%徒步%' THEN '旅行与户外'
 WHEN title LIKE '%健身%' OR title LIKE '%跑%' OR title LIKE '%运动%' THEN '运动与健康'
 WHEN title LIKE '%东京8平米%' OR title LIKE '%不买%' THEN '日常生活'
 WHEN title LIKE '%课%' OR title LIKE '%声乐%' OR title LIKE '%学%' THEN '学习与成长'
 ELSE '日常生活' END
WHERE category IS NULL;
