-- Channel trail naming fixes, from what production referrers actually look like.
--
--   * Android apps send android-app://<package> as the referrer, so the Reddit app showed up as
--     "com.reddit.frontpage" next to reddit. Common app packages now map to their service.
--   * New kinds: email (gmail, outlook) and messaging (google messages, telegram, whatsapp, slack)
--     -- a link someone sent. messages.google.com used to be claimed by the google search rule.
--   * localhost is direct (a dev session that leaked a referrer).
--   * "no web visit" is "no page view": most of those people downloaded, from a direct link to
--     an installer with no page view and no referrer.
--
-- Same signatures and columns as 0022, so everything built on them picks this up.

create or replace function public.analytics_host_source(p_value text, out name text, out kind text)
language sql
immutable
parallel safe
set search_path = public
as $$
  select coalesce(m.name, x.h), coalesce(m.kind, 'referral')
  from (select lower(regexp_replace(trim(coalesce(p_value, '')), '^(www|m)\.', '', 'i')) as h) x
  left join lateral (
    select v.name, v.kind
    from (values
      -- Our own sign-in and checkout round trips: the visit started here.
      (10, '(^|\.)(accounts\.google\.com|checkout\.stripe\.com|billing\.stripe\.com|talysman\.app)$', 'direct', 'direct'),
      (11, '^(localhost|127\.0\.0\.1|\[?::1\]?)$', 'direct', 'direct'),
      -- Android apps send android-app://<package> as the referrer; the host is the package.
      (12, '^com\.reddit\.frontpage$', 'reddit', 'social'),
      (13, '^com\.google\.android\.googlequicksearchbox$', 'google', 'search'),
      (14, '^com\.google\.android\.youtube$', 'youtube', 'social'),
      (15, '^com\.(twitter\.android|x\.android)$', 'x', 'social'),
      (16, '^com\.linkedin\.android$', 'linkedin', 'social'),
      (17, '^com\.facebook\.(katana|orca)$', 'facebook', 'social'),
      (18, '^com\.instagram\.android$', 'instagram', 'social'),
      (19, '^com\.discord$', 'discord', 'social'),
      -- AI assistants.
      (20, '(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com)$|^chatgpt$', 'chatgpt', 'ai'),
      (21, '(^|\.)perplexity\.ai$|^perplexity$', 'perplexity', 'ai'),
      (22, '(^|\.)claude\.ai$|^claude$', 'claude', 'ai'),
      (23, '(^|\.)(gemini|bard)\.google\.com$|^gemini$', 'gemini', 'ai'),
      (24, '(^|\.)copilot\.microsoft\.com$|^copilot$', 'copilot', 'ai'),
      (25, '(^|\.)deepseek\.com$|^deepseek$', 'deepseek', 'ai'),
      (26, '(^|\.)grok\.com$|^grok$', 'grok', 'ai'),
      (27, '(^|\.)meta\.ai$', 'meta ai', 'ai'),
      (28, '(^|\.)(you|phind)\.com$', 'ai search', 'ai'),
      -- Email and messaging: a link someone sent them. Above search, which would claim
      -- *.google.com.
      (30, '^com\.google\.android\.gm$|(^|\.)mail\.google\.com$|^gmail$', 'gmail', 'email'),
      (31, '(^|\.)(outlook\.(live|office)\.com|mail\.yahoo\.com)$|^com\.microsoft\.office\.outlook$', 'email', 'email'),
      (32, '(^|\.)messages\.google\.com$|^com\.google\.android\.apps\.messaging$', 'google messages', 'messaging'),
      (33, '^(org\.telegram\.messenger|com\.whatsapp|com\.slack)$|(^|\.)(web\.telegram\.org|web\.whatsapp\.com|app\.slack\.com)$', 'messaging app', 'messaging'),
      -- Search engines.
      (40, '(^|\.)google(\.[a-z.]+)?$', 'google', 'search'),
      (41, '(^|\.)bing(\.com)?$', 'bing', 'search'),
      (42, '(^|\.)duckduckgo(\.com)?$', 'duckduckgo', 'search'),
      (43, '(^|\.)yahoo(\.[a-z.]+)?$', 'yahoo', 'search'),
      (44, '(^|\.)search\.brave\.com$|^brave$', 'brave', 'search'),
      (45, '(^|\.)ecosia(\.org)?$', 'ecosia', 'search'),
      (46, '(^|\.)kagi(\.com)?$', 'kagi', 'search'),
      (47, '(^|\.)yandex(\.[a-z.]+)?$', 'yandex', 'search'),
      (48, '(^|\.)baidu\.com$', 'baidu', 'search'),
      -- Social and communities.
      (60, '(^|\.)(reddit\.com|redd\.it)$|^reddit$', 'reddit', 'social'),
      (61, '(^|\.)(youtube\.com|youtu\.be)$|^youtube$', 'youtube', 'social'),
      (62, '(^|\.)(x\.com|t\.co|twitter\.com)$|^(x|twitter)$', 'x', 'social'),
      (63, '(^|\.)(facebook\.com|fb\.com|fb\.me)$|^(facebook|fb)$', 'facebook', 'social'),
      (64, '(^|\.)instagram\.com$|^(instagram|ig)$', 'instagram', 'social'),
      (65, '(^|\.)(linkedin\.com|lnkd\.in)$|^linkedin$', 'linkedin', 'social'),
      (66, '(^|\.)news\.ycombinator\.com$|^(hn|hackernews)$', 'hacker news', 'social'),
      (67, '(^|\.)producthunt\.com$|^producthunt$', 'product hunt', 'social'),
      (68, '(^|\.)tiktok\.com$|^tiktok$', 'tiktok', 'social'),
      (69, '(^|\.)threads\.(net|com)$|^threads$', 'threads', 'social'),
      (70, '(^|\.)bsky\.app$|^bluesky$', 'bluesky', 'social'),
      (71, '(^|\.)discord(app)?\.com$|^discord$', 'discord', 'social'),
      (72, '(^|\.)github\.com$|^github$', 'github', 'social')
    ) v(ord, pattern, name, kind)
    where x.h ~ v.pattern
    order by v.ord
    limit 1
  ) m on true
  where x.h <> ''
$$;

create or replace view public.analytics_person_trail
with (security_invoker = on) as
with first_touch as (
  select distinct on (person_id) person_id, utm_source, utm_medium, referrer_host
  from (
    select
      e.utm_source, e.utm_medium, e.referrer_host, e.occurred_at,
      coalesce(iu.person_id, idv.person_id, ia.person_id) as person_id
    from public.analytics_events e
    left join public.analytics_identities iu  on iu.identifier  = 'user:'   || e.user_id::text
    left join public.analytics_identities idv on idv.identifier = 'device:' || e.device_id::text
    left join public.analytics_identities ia  on ia.identifier  = 'anon:'   || e.anon_id::text
    where (nullif(e.utm_source, '') is not null or nullif(e.referrer_host, '') is not null)
      and coalesce(e.props->>'ua_class', '') <> 'bot'
  ) e
  where person_id is not null
  order by person_id, occurred_at
), t as (
  select
    p.id as person_id,
    p.user_id,
    p.first_seen_at,
    case when s.kind = 'direct' and p.first_landing_path is null then 'no page view' else s.name end as source,
    case when s.kind = 'direct' and p.first_landing_path is null then 'none' else s.kind end as source_kind,
    p.first_landing_path as landing_path,
    bt.channel as blog,
    bt.first_slug as blog_first,
    bt.cta_slug as blog_cta,
    bt.first_at as blog_at,
    a.slug as affiliate,
    p.affiliate_at
  from public.analytics_persons p
  left join first_touch ft on ft.person_id = p.id
  cross join lateral public.analytics_source(
    case when ft.person_id is not null then ft.utm_source else p.first_utm_source end,
    case when ft.person_id is not null then ft.utm_medium else p.first_utm_medium end,
    case when ft.person_id is not null then ft.referrer_host else p.first_referrer_host end
  ) s
  left join public.affiliates a on a.id = p.affiliate_id
  left join public.analytics_blog_touch bt on bt.person_id = p.id
)
select
  t.*,
  -- Source first (it's how they arrived), then the blog and the affiliate in the order they
  -- happened.
  concat_ws(' → ',
    t.source,
    case when t.blog is not null and (t.affiliate is null or t.blog_at <= t.affiliate_at) then t.blog || ' (blog)' end,
    case when t.affiliate is not null then t.affiliate || ' (affiliate)' end,
    case when t.blog is not null and t.affiliate is not null and t.blog_at > t.affiliate_at then t.blog || ' (blog)' end
  ) as journey
from t;
