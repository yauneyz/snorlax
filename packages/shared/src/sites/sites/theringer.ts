import { defineSite } from '../types.js';

export default defineSite({
  id: 'theringer',
  label: 'The Ringer',
  hosts: ['theringer.com'],
  appHosts: ['theringer.com', 'www.theringer.com'],
  networkDomains: [],
  features: [
    { id: 'content', label: 'Articles you open directly', default: 'allow' },
    { id: 'episodes', label: 'Podcast episodes you open directly', default: 'allow' },
    { id: 'search', label: 'Search', default: 'allow' },
    { id: 'feed', label: 'Homepage, topics & shows', description: 'The homepage and every topic, show, video, and creator listing.', default: 'block' },
    { id: 'recommendations', label: 'Recommended stories', description: 'The topic bar under the header, and "More From", "Most Read", and "Continue Reading" around an article or episode.', default: 'block' },
    { id: 'essentials', label: 'Sign-in & account', default: 'allow', locked: true },
  ],
  routes: [
    { feature: 'content', path: '^/[0-9]{4}/[0-9]{2}/[0-9]{2}/[^/]+/[^/]+$', judge: { contentSelector: 'article' } },
    { feature: 'episodes', path: '^/podcasts/[^/]+/[0-9]{4}/[0-9]{2}/[0-9]{2}/[^/]+$', judge: { contentSelector: 'main > section' } },
    { feature: 'search', path: '^/search$' },
    { feature: 'essentials', path: '^/(?:account|subscribe|sign-?in|login|logout|newsletters?)(?:/.*)?$' },
  ],
  fallbackFeature: 'feed',
  elements: [
    { feature: 'feed', selector: 'main', on: ['feed'] },
    { feature: 'recommendations', selector: '#the-pulse, [data-module="the-pulse"]' },
    // An article is `main > aside, article, aside` followed by a "Continue Reading" section.
    {
      feature: 'recommendations',
      selector: '[data-sentry-component="RelatedContent"], [data-sentry-component="ReadMore"], main > section',
      on: ['content'],
    },
    // An episode page is the player and the episode notes, then related articles and more episodes.
    { feature: 'recommendations', selector: 'main > section:nth-of-type(n+3)', on: ['episodes'] },
    { feature: 'content', selector: 'main', on: ['content'] },
    { feature: 'episodes', selector: 'main', on: ['episodes'] },
    { feature: 'search', selector: 'main', on: ['search'] },
  ],
  examples: [
    ['https://www.theringer.com/', 'feed'],
    ['https://www.theringer.com/topic/nba', 'feed'],
    ['https://www.theringer.com/podcasts', 'feed'],
    ['https://www.theringer.com/podcasts/the-rewatchables', 'feed'],
    ['https://www.theringer.com/creator/bill-simmons', 'feed'],
    ['https://www.theringer.com/videos', 'feed'],
    ['https://www.theringer.com/2026/09/24/nfl/nfl-best-bets-week-3', 'content'],
    ['https://www.theringer.com/podcasts/the-rewatchables/2026/09/21/law-abiding-citizen-with-bill-simmons-van-lathan-and-craig-horlbeck', 'episodes'],
    ['https://www.theringer.com/search?q=knicks', 'search'],
    ['https://www.theringer.com/account', 'essentials'],
  ],
});
