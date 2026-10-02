import { defineSite } from '../types.js';

// Threads renders no <main>/[role="main"]; each column's scroll body carries data-column-scrollable
// (its aria-label, "Column body", is localized). main stays in the list in case the markup changes.
const COLUMN = 'main, [role="main"], [data-column-scrollable]';

export default defineSite({
  id: 'threads',
  label: 'Threads',
  hosts: ['threads.com', 'threads.net'],
  appHosts: ['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'],
  networkDomains: ['cdninstagram.com', 'fbcdn.net'],
  features: [
    { id: 'content', label: 'Posts you open directly', description: 'A specific post and its replies.', default: 'allow' },
    { id: 'search', label: 'Search', default: 'allow' },
    { id: 'notifications', label: 'Activity', default: 'allow' },
    { id: 'compose', label: 'Posting', default: 'allow' },
    { id: 'feed', label: 'For you & Following feeds', description: 'The feeds on the home page and custom feeds.', default: 'block' },
    { id: 'recommendations', label: 'Search suggestions', description: 'Suggested accounts and trending topics on the search page.', default: 'block' },
    { id: 'profiles', label: 'Profiles', default: 'block' },
    { id: 'essentials', label: 'Sign-in & settings', default: 'allow', locked: true },
  ],
  routes: [
    { feature: 'content', path: '^/@[^/]+/post/([-_a-z0-9]+)(?:/.*)?$', judge: { contentSelector: COLUMN } },
    { feature: 'search', path: '^/search$', query: { q: '^[^&#]+$' } },
    { feature: 'recommendations', path: '^/search$' },
    { feature: 'notifications', path: '^/activity(?:/.*)?$' },
    { feature: 'compose', path: '^/intent/post$' },
    { feature: 'essentials', path: '^/(?:login|logout|settings|accounts)(?:/.*)?$' },
    { feature: 'profiles', path: '^/@[^/]+(?:/(?:replies|media|reposts))?$' },
  ],
  fallbackFeature: 'feed',
  elements: [
    { feature: 'feed', selector: COLUMN, on: ['feed'] },
    { feature: 'recommendations', selector: COLUMN, on: ['recommendations'] },
    { feature: 'content', selector: COLUMN, on: ['content'] },
    { feature: 'search', selector: COLUMN, on: ['search'] },
    { feature: 'notifications', selector: COLUMN, on: ['notifications'] },
    { feature: 'compose', selector: '[role="dialog"]', on: ['compose'] },
    { feature: 'compose', selector: ':is(a, [role="button"]):has(svg[aria-label="Create"])' },
    { feature: 'profiles', selector: COLUMN, on: ['profiles'] },
  ],
  examples: [
    ['https://www.threads.com/', 'feed'],
    ['https://www.threads.com/following', 'feed'],
    ['https://www.threads.net/', 'feed'],
    ['https://www.threads.com/@ada/post/C1abcDEF_23', 'content'],
    ['https://www.threads.net/@ada/post/C1abcDEF_23/media', 'content'],
    ['https://www.threads.com/search?q=rust', 'search'],
    ['https://www.threads.com/search', 'recommendations'],
    ['https://www.threads.com/activity', 'notifications'],
    ['https://www.threads.com/intent/post?text=hi', 'compose'],
    ['https://www.threads.com/login', 'essentials'],
    ['https://www.threads.com/settings/account', 'essentials'],
    ['https://www.threads.com/@ada', 'profiles'],
    ['https://www.threads.com/@ada/replies', 'profiles'],
  ],
  captureSeeds: [
    'https://www.threads.com/',
    'https://www.threads.com/search?q=news',
    'https://www.threads.com/search',
    'https://www.threads.com/activity',
    'https://www.threads.com/intent/post?text=hi',
    'https://www.threads.com/@zuck',
  ],
  android: { packages: ['com.instagram.barcelona'] },
});
