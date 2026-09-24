import { defineSite } from '../types.js';

export default defineSite({
  id: 'hackernews',
  label: 'Hacker News',
  hosts: ['news.ycombinator.com'],
  appHosts: ['news.ycombinator.com'],
  networkDomains: [],
  features: [
    { id: 'content', label: 'Stories you open directly', description: 'A specific story and its discussion.', default: 'allow' },
    { id: 'compose', label: 'Submitting & replying', default: 'allow' },
    { id: 'feed', label: 'Front page & listings', description: 'Top, new, past, ask, show, and comment listings.', default: 'block' },
    { id: 'profiles', label: 'User profiles', default: 'block' },
    { id: 'essentials', label: 'Sign-in & voting', default: 'allow', locked: true },
  ],
  routes: [
    { feature: 'content', path: '^/item$', query: { id: '^[0-9]+$' }, judge: { contentSelector: '.fatitem' } },
    { feature: 'compose', path: '^/(?:submit|reply|comment|edit)$' },
    { feature: 'profiles', path: '^/(?:user|submitted|threads|favorites)$' },
    { feature: 'essentials', path: '^/(?:login|logout|vote|changepw|forgot|x)$' },
  ],
  fallbackFeature: 'feed',
  elements: [
    // #bigbox is the page body below HN's header bar, whatever the page.
    { feature: 'feed', selector: '#bigbox', on: ['feed'] },
    { feature: 'content', selector: '#bigbox', on: ['content'] },
    { feature: 'compose', selector: '#bigbox', on: ['compose'] },
    { feature: 'profiles', selector: '#bigbox', on: ['profiles'] },
  ],
  examples: [
    ['https://news.ycombinator.com/', 'feed'],
    ['https://news.ycombinator.com/news', 'feed'],
    ['https://news.ycombinator.com/newest', 'feed'],
    ['https://news.ycombinator.com/item?id=123', 'content'],
    ['https://news.ycombinator.com/item?id=abc', 'feed'],
    ['https://news.ycombinator.com/submit', 'compose'],
    ['https://news.ycombinator.com/user?id=pg', 'profiles'],
    ['https://news.ycombinator.com/login', 'essentials'],
  ],
});
