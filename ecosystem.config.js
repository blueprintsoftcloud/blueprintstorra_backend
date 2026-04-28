// PM2 Ecosystem config for VPS deployment
// Usage:
//   npm run build          # Compile TypeScript
//   pm2 start ecosystem.config.js --env production
//   pm2 save               # Persist across reboots
//   pm2 startup            # Register PM2 as a system service

module.exports = {
  apps: [
    {
      name: "blueprint-crm-api",
      script: "dist/server.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "512M",
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      out_file: "/var/log/blueprint-crm/out.log",
      error_file: "/var/log/blueprint-crm/error.log",
      merge_logs: true,

      env: {
        NODE_ENV: "development",
        PORT: 5000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 5000,
        // All other secrets come from .env — do NOT put them here.
        // Set them in /etc/blueprint-crm.env and load with 'env_file' or
        // copy to crm_backend/.env before starting.
      },
    },
  ],
};
