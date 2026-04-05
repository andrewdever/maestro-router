/**
 * @maestro/router — Plugin loader registry.
 *
 * Maps plugin IDs to lazy dynamic imports. Each plugin module exports
 * `default` as a RouterPlugin instance. Using dynamic imports enables
 * tree-shaking — only the active plugin is loaded at runtime.
 */

import type { PluginLoaderRegistry } from '../types.js';

export const ROUTER_PLUGINS: PluginLoaderRegistry = {
  maestro: () => import('./maestro.js'),
  direct: () => import('./direct.js'),
  openrouter: () => import('./openrouter.js'),
  requesty: () => import('./requesty.js'),
  portkey: () => import('./portkey.js'),
  litellm: () => import('./litellm.js'),
  mock: () => import('./mock.js'),
};
