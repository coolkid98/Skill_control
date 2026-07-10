import { assertRuntimeConfig, config } from './config.js';
import { initDb } from './db.js';
import { createApp } from './app.js';

assertRuntimeConfig();
initDb();

const app = createApp();
app.listen(config.port, () => {
  console.log(`[skill-control] listening on :${config.port}`);
  if (!config.isProduction) console.log('[skill-control] 本地默认管理员：admin / admin12345（首次登录必须修改）');
});
