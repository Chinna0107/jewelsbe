module.exports = {
  apps: [
    {
      name: "mokshamandir-server",
      script: "index.js",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 5000,
      }
    }
  ]
};
