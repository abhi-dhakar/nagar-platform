/* global process */
process.env.BETTER_AUTH_SECRET ??= "nagar-test-secret-keep-out-of-production-000000";
process.env.BETTER_AUTH_URL ??= "http://localhost:4000";
process.env.TRUSTED_ORIGINS ??= "http://localhost:3000";
process.env.CORS_ORIGINS ??= "http://localhost:3000";
process.env.DATABASE_URL ??=
  "postgresql://nagar:nagar_local_only@127.0.0.1:5432/nagar?schema=public";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
// 32 bytes of hex, for the webhook secret encryption tests only.
process.env.NAGAR_WEBHOOK_ENCRYPTION_KEY ??= "a1".repeat(32);
process.env.NODE_ENV = "test";
