/** 上线前把 CORS_ORIGIN 改成你的 https 域名。密钥放 apps/api/.env，勿写进本文件。 */
module.exports = {
  apps: [
    {
      name: 'railvista-api',
      script: 'apps/api/dist/index.js',
      cwd: __dirname + '/..',
      env: {
        PORT: 3000,
        CORS_ORIGIN: 'https://waybook.tyuho.cn',
        NODE_ENV: 'production',
      },
    },
  ],
};
