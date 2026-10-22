import 'dotenv/config';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/cove_test';
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.SESSION_SECRET = 'unit-integration-test-secret-not-for-production-123';

process.env.LOG_LEVEL = "silent";
