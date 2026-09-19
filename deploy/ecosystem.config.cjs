module.exports = {
  apps: [
    {
      name: 'railvista-api',
      script: 'apps/api/dist/index.js',
      cwd: __dirname + '/..',
      env: {
        PORT: 3000,
        CORS_ORIGIN: 'https://your.domain.com',
        NODE_ENV: 'production',
      },
    },
  ],
};
