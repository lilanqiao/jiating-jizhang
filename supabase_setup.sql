-- 在 Supabase 项目 → 左侧 SQL Editor → 新建查询 → 粘贴全部 → 点 Run
-- 作用：建一张全家共用的账本表 + 开启三人实时同步

create table if not exists public.records (
  id         text primary key,
  kind       text not null,            -- 'in' 收入 / 'out' 支出
  amount     numeric not null,
  cat        text,                     -- 分类
  note       text,                     -- 精简后的短标题
  raw        text,                     -- 当时说的原话（详情用）
  no_count   boolean default false,    -- 还款/转账：不计入收支统计
  creator_id text,                     -- 谁记的：a=爸爸 b=妈妈 c=宝贝
  ts         bigint,                   -- 时间戳(毫秒)
  book       text not null default 'home',  -- 家庭账本ID
  created_at timestamptz default now()
);

create index if not exists records_book_ts on public.records (book, ts desc);

-- 家庭内部共享：允许匿名读写（私有家庭账本，靠不公开的项目地址保护）
alter table public.records enable row level security;

drop policy if exists "family all" on public.records;
create policy "family all" on public.records
  for all using (true) with check (true);

-- 开启实时同步（谁记一笔，三部手机秒同步）
alter publication supabase_realtime add table public.records;

-- 定期设定表（固定支出的“设定”，跨设备共享、重装不丢）
create table if not exists public.recur_defs (
  id text primary key,
  book text not null default 'home',
  name text, amount numeric, kind text, cat text,
  period text, day int, month int, creator_id text, start_ts bigint,
  created_at timestamptz default now()
);
alter table public.recur_defs enable row level security;
drop policy if exists "family all defs" on public.recur_defs;
create policy "family all defs" on public.recur_defs for all using (true) with check (true);
alter publication supabase_realtime add table public.recur_defs;
