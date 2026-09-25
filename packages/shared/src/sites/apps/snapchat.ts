import { defineApp } from '../types.js';

export default defineApp({
  id: 'snapchat',
  label: 'Snapchat',
  features: [
    { id: 'chat', label: 'Chat', default: 'allow' },
    { id: 'camera', label: 'Camera', default: 'allow' },
    { id: 'stories', label: 'Friends’ stories', default: 'allow' },
    { id: 'spotlight', label: 'Spotlight', description: 'The short-video feed.', default: 'block' },
    { id: 'discover', label: 'Discover', description: 'Publisher and creator stories.', default: 'block' },
  ],
  android: {
    packages: ['com.snapchat.android'],
    screens: [
      {
        feature: 'spotlight',
        match: [{ contentDesc: '^Spotlight$', selected: true }],
        action: 'clickAlternative',
        alternative: { contentDesc: '^Chat$' },
        maxTested: '13.x',
      },
      {
        feature: 'discover',
        match: [{ contentDesc: '^(Stories|Discover)$', selected: true }, { text: '^Discover$' }],
        action: 'overlay',
        hideNodes: [{ text: '^Discover$' }],
        maxTested: '13.x',
      },
    ],
  },
});
