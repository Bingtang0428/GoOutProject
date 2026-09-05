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

-- 邀请码登录(替代邮箱注册):码可设置使用次数 1-100
create table if not exists public.invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,              -- 邀请码(可含字母数字 -)
  role        text not null default 'member'
              check (role in ('admin','member','viewer')),
  plan_id     uuid references public.plans(id) on delete cascade, -- 成员/围观码必须绑定计划
  label       text not null default '',          -- 用途备注,如 “接待民宿老板”
  max_uses    int  not null default 1 check (max_uses between 1 and 100),
  use_count   int  not null default 0,
  created_by  jsonb,                             -- 谁生成的
  created_at  timestamptz not null default now(),
  used_by     jsonb,                             -- 最近一次使用者 {id,name}
  used_at     timestamptz,
  revoked     boolean not null default false
);

-- 账号(注册时由邀请码验证建立;之后用昵称+密码登录,不再需要邀请码)
create extension if not exists pgcrypto;

create table if not exists public.accounts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,          -- 登录昵称
  password_hash text not null,                 -- crypt 哈希
  role          text not null default 'member' check (role in ('admin','member','viewer')),
  disabled      boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ★ 注册:昵称 + 密码 + 邀请码(原子:校验码→扣次数→建账号→自动加入计划名单)
create or replace function public.register_account(p_name text, p_password text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rec     public.invite_codes%rowtype;
  new_id  uuid;
begin
  if exists (select 1 from public.accounts where name = p_name) then
    return jsonb_build_object('ok', false, 'reason', 'name_taken');
  end if;
  select * into rec from public.invite_codes where code = upper(trim(p_code)) limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'invite_not_found'); end if;
  if rec.revoked then return jsonb_build_object('ok', false, 'reason', 'invite_revoked'); end if;
  if rec.use_count >= rec.max_uses then return jsonb_build_object('ok', false, 'reason', 'invite_exhausted'); end if;

  insert into public.accounts (name, password_hash, role)
  values (p_name, crypt(p_password, gen_salt('bf', 10)), rec.role)
  returning id into new_id;

  update public.invite_codes
     set use_count = use_count + 1, used_at = now(), used_by = jsonb_build_object('id', new_id, 'name', p_name)
   where id = rec.id;

  -- 绑定计划:自动加入 参与者/围观者 名单
  if rec.role = 'member' and rec.plan_id is not null then
    update public.plans
       set members = members || jsonb_build_array(jsonb_build_object('id', new_id, 'name', p_name))
     where id = rec.plan_id
       and not members @> jsonb_build_array(jsonb_build_object('id', new_id));
  elsif rec.role = 'viewer' and rec.plan_id is not null then
    update public.plans
       set viewers = viewers || jsonb_build_array(jsonb_build_object('id', new_id, 'name', p_name))
     where id = rec.plan_id
       and not viewers @> jsonb_build_array(jsonb_build_object('id', new_id));
  end if;

  return jsonb_build_object('ok', true, 'id', new_id, 'name', p_name, 'role', rec.role, 'plan_id', rec.plan_id);
end; $$;

-- ★ 登录:昵称 + 密码(无邀请码)
create or replace function public.login_account(p_name text, p_password text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec public.accounts%rowtype;
begin
  select * into rec from public.accounts where name = p_name limit 1;
  if not found then return jsonb_build_object('ok', false, 'reason', 'account_not_found'); end if;
  if rec.disabled then return jsonb_build_object('ok', false, 'reason', 'account_disabled'); end if;
  if rec.password_hash <> crypt(p_password, rec.password_hash) then
    return jsonb_build_object('ok', false, 'reason', 'wrong_password');
  end if;
  return jsonb_build_object('ok', true, 'id', rec.id, 'name', rec.name, 'role', rec.role);
end; $$;

-- ★ 后台:管理员重置成员密码
create or replace function public.admin_set_password(p_id uuid, p_password text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.accounts set password_hash = crypt(p_password, gen_salt('bf', 10)) where id = p_id;
end; $$;

-- ★ 后台:删除成员(从所有计划名单中移出;仍为计划创建者则拒绝)
create or replace function public.admin_delete_account(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p plans%rowtype;
begin
  if exists (select 1 from public.plans where owner_id = p_id::text) then
    return jsonb_build_object('ok', false, 'reason', 'owner_plans');
  end if;
  for p in select * from public.plans loop
    update public.plans
       set members = coalesce((select jsonb_agg(e) from jsonb_array_elements(p.members) e where e->>'id' <> p_id::text), '[]'::jsonb),
           viewers = coalesce((select jsonb_agg(e) from jsonb_array_elements(p.viewers) e where e->>'id' <> p_id::text), '[]'::jsonb)
     where id = p.id;
  end loop;
  delete from public.accounts where id = p_id;
  return jsonb_build_object('ok', true);
end; $$;

alter table public.accounts enable row level security;
drop policy if exists "accounts_all" on public.accounts;
create policy "accounts_all" on public.accounts for all using (true) with check (true);


insert into public.invite_codes (code, role, label, max_uses)
select 'TT-ADMIN-2026', 'admin', '内置管理员(首次登录后请撤销)', 3
where not exists (select 1 from public.invite_codes where role = 'admin');

create index if not exists idx_invite_codes_plan on public.invite_codes(plan_id);

-- ★ 占用邀请码(带次数控制,原子操作)
create or replace function public.claim_invite(p_code text, p_user jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.invite_codes%rowtype;
begin
  select * into rec from public.invite_codes where code = p_code limit 1 for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invite_not_found');
  end if;
  if rec.revoked then
    return jsonb_build_object('ok', false, 'reason', 'invite_revoked');
  end if;
  if rec.use_count >= rec.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'invite_exhausted');
  end if;
  update public.invite_codes
     set use_count = use_count + 1,
         used_at   = now(),
         used_by   = p_user
   where id = rec.id;
  return jsonb_build_object(
    'ok', true,
    'role', rec.role,
    'plan_id', rec.plan_id,
    'remaining', rec.max_uses - rec.use_count - 1
  );
end;
$$;


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
  capacity_l  numeric(6,2),                       -- 油箱容积 L(续航建议用)
  cons_l100   numeric(6,2),                       -- 百公里油耗 L(可覆盖自动测算)
  created_at  timestamptz not null default now()
);
alter table public.vehicles add column if not exists capacity_l numeric(6,2);
alter table public.vehicles add column if not exists cons_l100 numeric(6,2);

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
alter table public.invite_codes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['plans','route_days','stays','todos','guides','reminders','bills','comments','transits','vehicles','fuel_logs','invite_codes'] loop
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
