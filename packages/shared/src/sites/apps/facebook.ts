import { defineApp } from '../types.js';

export default defineApp({
  id: 'facebook',
  label: 'Facebook',
  features: [
    { id: 'messages', label: 'Messages', default: 'allow' },
    { id: 'groups', label: 'Groups', default: 'allow' },
    { id: 'marketplace', label: 'Marketplace', default: 'allow' },
    { id: 'feed', label: 'News feed', default: 'block' },
    { id: 'reels', label: 'Reels & video', default: 'block' },
  ],
  android: {
    packages: ['com.facebook.katana'],
    screens: [
      {
        feature: 'reels',
        match: [{ contentDesc: '^(Reels|Video)(, tab \\d+ of \\d+)?$', selected: true }],
        action: 'clickAlternative',
        alternative: { contentDesc: '^(Groups|Marketplace)(, tab \\d+ of \\d+)?$' },
        maxTested: '480.x',
      },
      {
        feature: 'feed',
        match: [{ contentDesc: '^Home(, tab \\d+ of \\d+)?$', selected: true }],
        action: 'overlay',
        maxTested: '480.x',
      },
    ],
  },
});
