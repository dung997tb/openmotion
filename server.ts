import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLogger } from './src/infra/logger.ts';
import {
  createApiApp,
  serveStaticAsset,
  startApiServer,
  type ApiAppServices,
  type ApiServerHandle,
  type CreateApiAppDeps,
  type StartApiServerOptions,
} from './src/entrypoints/api.ts';

export {
  createApiApp,
  serveStaticAsset,
  startApiServer,
  type ApiAppServices,
  type ApiServerHandle,
  type CreateApiAppDeps,
  type StartApiServerOptions,
};

function isDirectEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectEntry()) {
  startApiServer({ installSignals: true }).catch((error) => {
    const logger = createLogger({ level: 'error', bindings: { service: 'server-entrypoint' } });
    logger.error('Fatal server startup failure', { error });
    process.exit(1);
  });
}
