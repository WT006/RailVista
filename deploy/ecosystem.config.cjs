/**
 * 4GB 单机推荐：单实例 + 堆上限 + 内存重启护栏。
 * 勿在同一台机开 instances>1（走廊/路网图会各拷一份）。
 * 需要预热普速热清单时把 RAIL_SEG_PREWARM_MODE 改为 all。
 */
module.exports = {
  apps: [
    {
      name: 'railvista-api',
      script: 'apps/api/dist/index.js',
      cwd: __dirname + '/..',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=1536',
      max_memory_restart: '1800M',
      env: {
        PORT: 3000,
        CORS_ORIGIN: 'https://your.domain.com',
        NODE_ENV: 'production',
        // 只预热 G/D/C，避免启动后立刻加载 ~70MB 普速 graph
        RAIL_SEG_PREWARM_MODE: 'hsr',
      },
    },
  ],
};
