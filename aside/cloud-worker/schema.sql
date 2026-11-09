-- 一条记录一行，data 是整条 entry 的 JSON 字符串。
-- 不拆成结构化字段：前端 entry 的形状还在变（imgs/pin 都是后加的），
-- 拆了每次改前端都要跟着迁移数据库，整存整取反而省事。
CREATE TABLE IF NOT EXISTS entries (
  id      TEXT PRIMARY KEY,
  data    TEXT    NOT NULL DEFAULT '',
  updated INTEGER NOT NULL,           -- 服务器时间，客户端拿它当增量拉取的游标
  deleted INTEGER NOT NULL DEFAULT 0  -- 墓碑：删除必须留痕，否则别的设备下次同步又把它推回来
);

-- 增量拉取全靠这个索引
CREATE INDEX IF NOT EXISTS idx_entries_updated ON entries(updated);

-- 标签表整体存一行（k='tags'）。标签改动频率极低，
-- 按条同步不值当，最后写入的赢就够了。
CREATE TABLE IF NOT EXISTS meta (
  k       TEXT PRIMARY KEY,
  v       TEXT    NOT NULL,
  updated INTEGER NOT NULL
);
