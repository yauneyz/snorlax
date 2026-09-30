import { defineSite } from '../types.js';

// Pinterest serves each country from a subdomain (uk.pinterest.com, br.pinterest.com, …).
const COUNTRY_HOSTS = ['ar', 'at', 'au', 'br', 'ca', 'ch', 'cl', 'co', 'cz', 'de', 'dk', 'es', 'fi', 'fr', 'gr', 'hu', 'id', 'ie', 'in', 'it', 'jp', 'kr', 'mx', 'nl', 'no', 'nz', 'pe', 'ph', 'pl', 'pt', 'ro', 'ru', 'se', 'sk', 'tr', 'uk', 'za'].map(
  (country) => `${country}.pinterest.com`,
);

export default defineSite({
  id: 'pinterest',
  label: 'Pinterest',
  hosts: ['pinterest.com', 'pin.it'],
  appHosts: ['pinterest.com', 'www.pinterest.com', ...COUNTRY_HOSTS, 'pin.it'],
  networkDomains: ['pinimg.com'],
  features: [
    { id: 'content', label: 'Pins you open directly', default: 'allow' },
    { id: 'search', label: 'Search', default: 'allow' },
    { id: 'compose', label: 'Creating pins', default: 'allow' },
    { id: 'feed', label: 'Home feed', default: 'block' },
    { id: 'explore', label: 'Explore & Today', default: 'block' },
    { id: 'recommendations', label: 'More ideas', description: 'Related pins under the one you opened.', default: 'block' },
    { id: 'profiles', label: 'Profiles & boards', default: 'block' },
    { id: 'essentials', label: 'Sign-in & settings', default: 'allow', locked: true },
  ],
  routes: [
    { feature: 'content', host: 'pin.it', path: '^/([a-z0-9]+)$' },
    { feature: 'content', path: '^/pin/([-_a-z0-9]+)(?:/.*)?$', judge: { contentSelector: '[data-test-id="closeup-body"], [role="main"]' } },
    { feature: 'search', path: '^/search/(?:pins|boards|users|videos)$', query: { q: '^[^&#]+$' } },
    { feature: 'compose', path: '^/(?:pin-builder|pin-creation-tool|idea-pin-builder)(?:/.*)?$' },
    { feature: 'explore', path: '^/(?:today|ideas|explore)(?:/.*)?$' },
    { feature: 'essentials', path: '^/(?:login|signup|logout|settings|password|reset|oauth|_)(?:/.*)?$' },
    { feature: 'feed', path: '^/(?:homefeed|search)(?:/.*)?$' },
    { feature: 'profiles', path: '^/[^/]+(?:/[^/]+)?$' },
  ],
  fallbackFeature: 'feed',
  elements: [
    // The pin grid lives in `.mainContainer`; the header's search box sits outside it.
    { feature: 'feed', selector: '.mainContainer, [role="main"]', on: ['feed'] },
    { feature: 'explore', selector: '.mainContainer, [role="main"]', on: ['explore'] },
    { feature: 'explore', selector: 'a[href="/ideas/"], a[href="/today/"]' },
    { feature: 'recommendations', selector: '[data-test-id*="related"], [data-test-id*="more-ideas"], .masonryContainer', on: ['content'] },
    { feature: 'content', selector: '.mainContainer, [role="main"]', on: ['content'] },
    { feature: 'search', selector: '.mainContainer, [role="main"]', on: ['search'] },
    { feature: 'compose', selector: '.mainContainer, [role="main"]', on: ['compose'] },
    { feature: 'profiles', selector: '.mainContainer, [role="main"]', on: ['profiles'] },
  ],
  examples: [
    ['https://www.pinterest.com/', 'feed'],
    ['https://www.pinterest.com/homefeed/', 'feed'],
    ['https://www.pinterest.com/pin/123456789/', 'content'],
    ['https://uk.pinterest.com/pin/123456789/', 'content'],
    ['https://pin.it/abc123', 'content'],
    ['https://pin.it/', 'feed'],
    ['https://www.pinterest.com/search/pins/?q=rust', 'search'],
    ['https://www.pinterest.com/search/pins/', 'feed'],
    ['https://www.pinterest.com/pin-builder/', 'compose'],
    ['https://www.pinterest.com/today/', 'explore'],
    ['https://www.pinterest.com/ideas/home-decor/123/', 'explore'],
    ['https://www.pinterest.com/login/', 'essentials'],
    ['https://www.pinterest.com/settings/', 'essentials'],
    ['https://www.pinterest.com/ada/', 'profiles'],
    ['https://www.pinterest.com/ada/kitchen/', 'profiles'],
    ['https://ads.pinterest.com/', 'feed'],
  ],
  captureSeeds: [
    'https://www.pinterest.com/',
    'https://www.pinterest.com/search/pins/?q=kitchen',
    'https://www.pinterest.com/today/',
    'https://www.pinterest.com/ideas/',
    'https://www.pinterest.com/pin-builder/',
    'https://www.pinterest.com/pinterest/',
  ],
  android: { packages: ['com.pinterest'] },
});
