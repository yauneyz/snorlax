// Order matters: the desktop renderer reads `__APP_CONFIG__` and `window.api` at import time.
import './env';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './motion.css';
import { registerRoot } from 'remotion';
import { applyPaletteVariables } from '@talysman/shared';
import { Root } from './Root';

applyPaletteVariables(document.documentElement);
registerRoot(Root);
