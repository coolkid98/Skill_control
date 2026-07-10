import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { authRouter } from './auth.js';
import { adminRouter } from './admin-routes.js';
import { skillRouter } from './skill-routes.js';
import { config } from './config.js';
import { errorHandler, notFound } from './http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: config.isProduction ? {
      directives: {
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    } : false,
    strictTransportSecurity: config.cookieSecure ? undefined : false,
  }));
  app.use(express.json({ limit: '6mb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', skillRouter);

  if (config.isProduction) {
    const distPath = path.resolve(__dirname, '../../client/dist');
    app.use(express.static(distPath, { index: false }));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  } else {
    app.use('/api', notFound);
  }

  app.use(errorHandler);
  return app;
}
