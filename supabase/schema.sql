-- =============================================================
-- 同行 · 自驾旅行企划  —— Supabase 数据库结构
-- 在 Supabase Dashboard → SQL Editor 中直接运行本文件。
-- 注意: 演示阶段 RLS 全部放开(仅用于原型),上线前请务必收紧。
-- =============================================================

-- 计划(一次自驾旅行)
-- 权限模型:owner_id=创建者 / members(参与者,可编辑内容)/ viewers(围观者,只读)
create table if not exists public.plans (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                          -- 计划名称
  destination text not null default '',               -- 目的地
  start_city  text not null default '',               -- 集合城市(省市下拉,大交通默认带入)
  start_date  date not null,                          -- 出发日期
  end_date    date not null,                          -- 返程日期
  gradient    int  not null default 0,                -- 卡片柔和渐变配色索引
  owner_id    text,                                   -- 创建者 id(auth uid / 演示 user id)
  members     jsonb not null default '[]'::jsonb,     -- 参与者 [{id,name}]
  viewers     jsonb not null default '[]'::jsonb,     -- 围观者 [{id,name}]
  budget      numeric(12,2),                          -- 总预算(可选,用于预算看板)
  created_at  timestamptz not null default now()
);
-- 兼容旧库:补加新列
alter table public.plans add column if not exists owner_id text;
alter table public.plans add column if not exists viewers jsonb not null default '[]'::jsonb;
alter table public.plans add column if not exists budget numeric(12,2);
alter table public.plans add column if not exists start_city text not null default '';

-- 每日路线(每日一行,destinations 为当天地点数组)
create table if not exists public.route_days (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.plans(id) on delete cascade,
  date          date not null,
  title         text not null default '',             -- 当日主题,如 "合肥 → 黄山"
  destinations  jsonb not null default '[]'::jsonb,   -- [{id,place,note,time}]
  created_at    timestamptz not null default now(),
  unique (plan_id, date)
);

-- 食宿安排(type: stay=住宿 / food=餐饮)
create table if not exists public.stays (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans(id) on delete cascade,
  type       text not null default 'stay' check (type in ('stay', 'food')),
  name       text not null,
  address    text not null default '',
  phone      text not null default '',
  tags       jsonb not null default '[]'::jsonb,      -- ["已预订","人均¥100"]
  booked     boolean not null default false,
  created_at timestamptz not null default now()
);

-- TODO 清单
create table if not exists public.todos (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans(id) on delete cascade,
  title      text not null,
  done       boolean not null default false,
  due        date,                                    -- 截止日期,可为空
  created_at timestamptz not null default now()
);

-- 收藏攻略
create table if not exists public.guides (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans(id) on delete cascade,
  title      text not null,
  url        text not null default '',                -- 来源链接
  image      text not null default '',                -- 封面(storage 地址或外链)
  created_at timestamptz not null default now()
);

-- 提醒事项(read = 已读,页面中已读项自动变淡)
create table if not exists public.reminders (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans(id) on delete cascade,
  title      text not null,
  date       date not null,
  time       time not null default '09:00:00',
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

-- 分账(bill):与食宿(stays)/行程目的地联动,快照支付人与分摊人
create table if not exists public.bills (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans(id) on delete cascade,
  name        text not null,
  amount      numeric(12,2) not null default 0,
  category    text not null default 'other'
              check (category in ('stay','food','fuel','ticket','toll','other')),
  paid_by     jsonb,                              -- {id,name} 谁付的钱
  involves    jsonb not null default '[]'::jsonb, -- 参与分摊的人 [{id,name}]
  link        jsonb,                              -- 联动: {type:'stay'|'dest', id, name}
  note        text not null default '',
  created_at  timestamptz not null default now()
);

-- 行程建议评论:挂在某个目的地(dest)上,状态闭环 open→accepted→done
create table if not exists public.comments (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.plans(id) on delete cascade,
  day_date     date not null,                     -- 所属当天
  dest_id      text not null default '',          -- 目的地 id(route_days.destinations[*].id)
  text         text not null,
  author       jsonb not null,                    -- {id,name}
  status       text not null default 'open'
               check (status in ('open','accepted','done')),
  accepted_by  jsonb,                             -- 采纳人 {id,name}
  accepted_at  timestamptz,
  done_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- 大交通企划:每人的到达/离开(五湖四海拼到集合点)
create table if not exists public.transits (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans(id) on delete cascade,
  person      jsonb not null,                     -- {id,name}
  direction   text not null default 'in' check (direction in ('in','out')),
  mode        text not null default 'train'
              check (mode in ('flight','train','bus','car','other')),
  from_city   text not null default '',
  to_city     text not null default '',
  leg_date    date not null,
  time        text not null default '',
  ref_no      text not null default '',           -- 航班号 / 车次 / 班车
  note        text not null default '',
  created_at  timestamptz not null default now()
);

-- 车辆信息(每计划一行)
create table if not exists public.vehicles (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans(id) on delete cascade,
  name        text not null default '',           -- 爱车昵称
  plate       text not null default '',           -- 车牌
  created_at  timestamptz not null default now()
);

-- 加油/里程记录(油耗按相邻记录里程差计算)
create table if not exists public.fuel_logs (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans(id) on delete cascade,
  date        date not null,
  odometer    numeric(12,1),                      -- 表显里程 km
  liters      numeric(10,2),                      -- 加油升数
  amount      numeric(12,2),                      -- 油费金额
  paid_by     jsonb,                              -- 垫付人 {id,name}
  bill_id     text,                               -- 若同步记入分账,存对应 bills.id
  note        text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists idx_route_days_plan    on public.route_days(plan_id);
create index if not exists idx_stays_plan         on public.stays(plan_id);
create index if not exists idx_todos_plan         on public.todos(plan_id);
create index if not exists idx_guides_plan        on public.guides(plan_id);
create index if not exists idx_reminders_plan     on public.reminders(plan_id);
create index if not exists idx_bills_plan         on public.bills(plan_id);
create index if not exists idx_comments_plan      on public.comments(plan_id);
create index if not exists idx_transits_plan      on public.transits(plan_id);
create index if not exists idx_fuel_logs_plan     on public.fuel_logs(plan_id);

-- -------------------------------------------------------------
-- RLS:演示阶段允许匿名读写。正式环境请替换为基于 auth.uid() 的策略!
-- 角色约定:plans.owner_id=创建者、plans.members=参与者、plans.viewers=围观者。
-- 上线时建议:围观者仅 SELECT,参与者仅成员表 INSERT/UPDATE/DELETE。
-- -------------------------------------------------------------
alter table public.plans      enable row level security;
alter table public.route_days enable row level security;
alter table public.stays      enable row level security;
alter table public.todos      enable row level security;
alter table public.guides     enable row level security;
alter table public.reminders  enable row level security;
alter table public.bills      enable row level security;
alter table public.comments   enable row level security;
alter table public.transits   enable row level security;
alter table public.vehicles   enable row level security;
alter table public.fuel_logs  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['plans','route_days','stays','todos','guides','reminders','bills','comments','transits','vehicles','fuel_logs'] loop
    execute format('drop policy if exists "%s_all" on public.%I', t, t);
    execute format('create policy "%s_all" on public.%I for all using (true) with check (true)', t, t);
  end loop;
end $$;

-- -------------------------------------------------------------
-- Storage: 攻略封面 / 用户头像上传桶(公开读)
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do nothing;

drop policy if exists "covers_public_read" on storage.objects;
create policy "covers_public_read" on storage.objects
  for select using (bucket_id = 'covers');

drop policy if exists "covers_public_insert" on storage.objects;
create policy "covers_public_insert" on storage.objects
  for insert with check (bucket_id = 'covers');
