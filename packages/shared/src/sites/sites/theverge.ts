import { defineSite } from '../types.js';

export default defineSite({
  id: 'theverge',
  label: 'The Verge',
  hosts: ['theverge.com'],
  appHosts: ['theverge.com', 'www.theverge.com'],
  networkDomains: [],
  features: [
    { id: 'content', label: 'Articles you open directly', default: 'allow' },
    { id: 'search', label: 'Search', default: 'allow' },
    { id: 'feed', label: 'Homepage & section pages', description: 'The homepage, story streams, and section and tag pages.', default: 'block' },
    { id: 'recommendations', label: 'Recommended stories', description: 'Most Popular, "More in", and related links around an article.', default: 'block' },
    { id: 'profiles', label: 'Author pages', default: 'block' },
    { id: 'essentials', label: 'Sign-in & account', default: 'allow', locked: true },
  ],
  routes: [
    // /<section>/<id>/<slug>, and the older /<yyyy>/<m>/<d>/<id>/<slug>.
    { feature: 'content', path: '^/(?:[a-z0-9-]+|[0-9]{4}/[0-9]{1,2}/[0-9]{1,2})/[0-9]+/[^/]+$', judge: { contentSelector: 'article' } },
    { feature: 'search', path: '^/search$' },
    { feature: 'profiles', path: '^/authors/[^/]+$' },
    { feature: 'essentials', path: '^/(?:account|subscribe|sign-?in|login|logout|newsletters?)(?:/.*)?$' },
  ],
  fallbackFeature: 'feed',
  elements: [
    { feature: 'feed', selector: 'main', on: ['feed'] },
    {
      feature: 'recommendations',
      selector: '.duet--layout--rail, .duet--layout--article-recirc-color-container, .duet--layout--header-pattern, .duet--article--related, .duet--ad--native-ad-linkset',
      on: ['content', 'search'],
    },
    { feature: 'recommendations', selector: '.duet--homepage--most-popular, .duet--homepage--most-discussed' },
    { feature: 'content', selector: 'main', on: ['content'] },
    { feature: 'search', selector: 'main', on: ['search'] },
    { feature: 'profiles', selector: 'main', on: ['profiles'] },
  ],
  examples: [
    ['https://www.theverge.com/', 'feed'],
    ['https://www.theverge.com/tech', 'feed'],
    ['https://www.theverge.com/reviews', 'feed'],
    ['https://www.theverge.com/tech/999944/meta-muse-charm-ai-interact-5g-modem', 'content'],
    ['https://www.theverge.com/2024/1/9/24031234/some-story', 'content'],
    ['https://www.theverge.com/search?q=pixel', 'search'],
    ['https://www.theverge.com/authors/emma-roth', 'profiles'],
    ['https://www.theverge.com/account', 'essentials'],
    ['https://www.theverge.com/subscribe', 'essentials'],
  ],
});
