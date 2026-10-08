Developer + Marketing execution plan • 7 October 2026

Decision: ship and validate the existing 22 search-intent pages before materially expanding coverage. Add four carefully differentiated pages next; let Search Console data determine further expansion.

# 1. Executive summary

Talysman’s supplied SEO/GEO layout defines one page per distinct search intent, with answer-first copy, real product demonstrations, honest limitations, vendor-supported competitor comparisons, and deep internal linking. The current inventory of 22 intent pages provides a credible initial launch across blocker bypass, physical-key differentiation, competitors, platforms, and real-world distraction use cases.

The key risk is not publishing all pages simultaneously: bulk publishing has no inherent Google penalty. The risks are thin/duplicative content, weak intent differentiation, unverified product claims, production indexability issues, and insufficient external authority. The audit previously raised a possible discrepancy between the implementation document and the public site; treat that as a verification item, not a confirmed production defect.

# 2. Scope, evidence and definitions

- Source of implementation status: “SEO / GEO layout” (updated October 7, 2026). Items marked completed there are reported implementation status, not independently verified in production.

- Additional recommendations below are editorial/SEO hypotheses from the prior audit. Search demand, competitive difficulty and rankings have not been quantified.

- SEO = search visibility and conversions; GEO = likelihood of accurate mention/citation in AI-assisted search. A concise answer block is useful but does not guarantee a snippet or citation.

# 3. Existing inventory — keep and launch

| Cluster                  | Existing URLs / intent                                                                                                                                                                                                    |
|--------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Mechanism and bypass     | /physical-website-blocker; /website-blocker-you-cant-turn-off; /stop-disabling-website-blocker; /blocker-for-people-who-bypass-blockers; /digital-lock-vs-physical-friction; /turn-a-usb-drive-into-a-distraction-blocker |
| Comparisons              | /cold-turkey-alternative; /freedom-alternative; /focusme-alternative; /brick-for-computer; /cold-turkey-vs-freedom-vs-focusme                                                                                             |
| Platform and application | /website-blocker-windows; /website-blocker-mac; /website-blocker-linux; /app-blocker-pc                                                                                                                                   |
| Workflows and audiences  | /deep-work-blocker; /block-reddit-while-working; /block-youtube-while-working; /block-social-media-on-computer; /focus-app-developers; /focus-app-writers; /focus-app-remote-work                                         |

Keep root-level URLs as specified by the current architecture. Do not introduce /compare/ or /guides/ folders solely for SEO; the existing footer groupings and related-page links provide the planned organization.

# 4. Prioritized backlog

| ID / priority | Owner                   | Task and acceptance criteria                                                                                                                                                                                                                  |
|---------------|-------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| DEV-01 / P0   | Engineering             | Deploy existing work. Verify each of 22 intended URLs resolves to a distinct, indexable HTML page on www.talysman.app; no unexpected redirects, 404s, noindex or robots blocking.                                                             |
| DEV-02 / P0   | Engineering             | Verify sitemap.xml contains expected production URLs (document anticipates 32 total), correct canonical host, and legitimate lastModified values. Verify 308 legacy redirects and update any internal links to new destinations.              |
| DEV-03 / P0   | Engineering + Product   | Audit high-risk claims across new and older pages: macOS uninstall behavior, emergency unlocks (5 per computer), Strict Mode default off, network-level blocking and platform limitations. Fix copy or product implementation as appropriate. |
| DEV-04 / P0   | Engineering             | Fix marketing e2e price assertion mismatch; run marketing and intent-page tests against the deployed build. Check one H1, unique title/meta, canonical, server-rendered answer, and usable media across pages.                                |
| MKT-01 / P0   | SEO/Marketing           | Complete distinct-intent editorial review of all 22 pages. Preserve honest comparisons, source vendor claims, review dates, and the answer-first format.                                                                                      |
| MKT-02 / P0   | SEO/Marketing           | Submit production sitemap to Google Search Console and Bing Webmaster Tools; inspect the eight priority URLs from the source plan. Record index status and exclusions; request indexing only where useful.                                    |
| DEV-05 / P1   | Engineering + Analytics | Tag all download CTAs by originating URL and measure visits, CTA clicks, download starts and activation where privacy-safe. Build a page-by-page funnel report.                                                                               |
| MKT-03 / P1   | Content                 | Write four proposed new pages, each with distinct audience/problem, screenshots, unique evidence, relevant CTA, and links into existing clusters. Release only after product and keyword fit validation.                                      |
| DEV-06 / P1   | Engineering             | Capture mobile/desktop Core Web Vitals baseline for homepage, pricing, Cold Turkey alternative and mechanism page. If TTFB is high, assess making marketing pages static instead of auth-dependent.                                           |
| MKT-04 / P1   | PR/Community            | Earn relevant independent mentions and references through transparent community participation, product demos and useful comparisons; no indiscriminate link drops.                                                                            |
| MKT-05 / P2   | SEO/Marketing           | Run repeatable GEO benchmark across designated engines/prompts; track mention, URL citation and factual accuracy. Recheck competitor facts quarterly.                                                                                         |

# 5. Four proposed next pages — conditional, not yet approved

| Proposed slug              | Search intent                                                             | Content boundary / proof                                                                         |
|----------------------------|---------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| /selfcontrol-alternative   | Mac SelfControl users seeking cross-platform or physically gated blocking | Clearly compare platform support, lock model, setup and tradeoffs; verify competitor facts.      |
| /free-website-blocker      | Users actively evaluating a free blocking tool                            | Lead with actual free-tier scope, site limits and upsell boundaries from product constants.      |
| /block-discord-on-pc       | Desktop distraction from Discord                                          | Show whether/how desktop app blocking works on supported OSs; distinguish from website blocking. |
| /block-steam-while-working | PC gaming distraction during work/study                                   | Show app-level blocking and precise limitations; avoid a near-duplicate Discord template.        |

Secondary research queue, not the next sprint: /website-blocker-with-schedule; /block-websites-without-blocking-entire-site; /blocksite-alternative; /website-blocker-all-browsers. Confirm demand, product capability and distinct intent before assigning.

# 6. Overlap control and editorial rules

| Pages at risk of overlap                                           | Required differentiation                                                                            |
|--------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| “can’t turn off” vs “people who bypass blockers”                   | First = selecting a resilient blocker; second = behavioral/persona problem and evaluation criteria. |
| “stop disabling” vs above                                          | Instructional how-to with practical setup/workflow, not another alternative list.                   |
| “deep work” vs developer/writer pages                              | Broad deep-work selection vs profession-specific tools, exclusions and actual scenarios.            |
| “app blocker PC” vs “website blocker Windows”                      | Installed desktop applications vs browser/domain-level blocking.                                    |
| “physical website blocker” vs “digital locks vs physical friction” | Product mechanism demonstration vs category-level comparison and tradeoffs.                         |

- Each landing page must have a distinct primary question, title/H1, immediately useful answer, demonstrated feature, honest constraints, and non-generic proof.

- Avoid many lightly rewritten keyword variants. Consolidate or canonicalize only after evidence shows pages serve substantially the same intent; do not preemptively delete productive pages.

- Competitor claims must link to primary vendor documentation and include a review date; refresh only after a real recheck.

# 7. Release gates and QA checklist

- [ ] All 22 public URLs return 200 and contain unique title/H1, self-canonical, indexable server-rendered copy.

- [ ] Sitemap, robots.txt, canonical host and five legacy 308 redirects checked on production.

- [ ] Header/footer and related-page links are visible and usable on mobile and desktop; check 375px nav wrapping.

- [ ] Product security and uninstall messaging reconciled with actual behavior on Windows, macOS and Linux.

- [ ] Schema uses visible, truthful values; no invented review ratings; rich results tested on homepage and pricing.

- [ ] Demo video posters, playback, screenshots and above-the-fold load performance checked.

- [ ] Analytics distinguishes organic landing pages and downstream signup/download activity.

- [ ] Search Console/Bing properties owned by team; baseline report exported and assigned.

# 8. Timeline / ownership

| When          | Engineering / Product                                                                          | Marketing / SEO                                                                                                                |
|---------------|------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| Week 0        | Deploy, production smoke tests, fix claim-sensitive product/copy issues, establish measurement | Editorial check, sitemap submission, inspect source-plan top eight URLs, initial GEO baseline                                  |
| Weeks 1–2     | Resolve QA defects and add CTA attribution; record CWV baseline                                | Publish contextual education/demo content; selectively engage relevant communities with disclosure; draft four new-page briefs |
| Weeks 2–4     | Support measured page additions and analytics dashboard                                        | Release approved four pages if differentiated; pursue independent coverage; monitor queries and indexing                       |
| Every 2 weeks | Review conversion funnel and technical issues                                                  | Review GSC impressions/clicks/queries; rerun fixed GEO prompts                                                                 |
| Quarterly     | Revalidate product capability claims                                                           | Recheck competitor facts and review dates; prioritize content by observed performance                                          |

# 9. Measurement and decision rules

- Indexability: indexed / eligible URLs, exclusions by reason, crawl errors, sitemap discovery.

- Search: impressions, organic clicks, CTR, query-to-page alignment, meaningful ranking movement; segment branded vs nonbranded.

- Business: organic landing-to-download and landing-to-activation rates, grouped by page cluster; avoid optimizing for traffic alone.

- GEO: the 40 fixed prompts in the supplied plan, run consistently, logging engine/date, mentioned, cited URL, accuracy and competitors named. Treat manual fresh-session outputs as indicative rather than statistically controlled.

- 90-day directional goal from source plan: Talysman named in ≥50% of constraint and Brick-for-desktop prompts on at least two engines, cited in ≥25%. This is a planning target, not a forecast.

Decision point after 4–8 weeks of usable data: expand high-converting intent clusters, rewrite misaligned pages, merge truly redundant pages, and deprioritize pages with weak qualified engagement. Do not judge SEO solely by a first-week indexing result.

# 10. Open decisions and dependencies

- Confirm whether the 22-page release is actually deployed on the canonical www host; the prior live-site audit suggested a mismatch but did not conclusively verify all target URLs.

- Choose whether to implement a macOS uninstall guard or maintain explicit platform-qualified copy everywhere.

- Confirm whether the four recommended expansions each match shipped product capabilities, actual query demand and production priorities.

- Assign individuals to Engineering, Product/QA, SEO/Content, Analytics and Community/PR; establish one shared ticket board and dashboard.

# 11. Sources and assumptions

Primary source: internal “SEO / GEO layout”, last updated October 7, 2026 (provided with this brief): page registry, product-claim notes, implementation and testing status, launch plan, and 40-prompt GEO rubric. Secondary source: prior conversational audit of talysman.app, which proposed eight additional topics and flagged possible production/deployment mismatches. Its live-site observations require direct production reconfirmation. This brief does not assert independently verified search volume, rankings, site accessibility, or competitor specifications.
