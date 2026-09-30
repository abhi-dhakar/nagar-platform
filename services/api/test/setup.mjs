/* global process */
process.env.BETTER_AUTH_SECRET ??= "nagar-test-secret-keep-out-of-production-000000";
process.env.DATABASE_URL ??=
  "postgresql://nagar:nagar_local_only@127.0.0.1:5432/nagar?schema=public";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.NODE_ENV = "test";
