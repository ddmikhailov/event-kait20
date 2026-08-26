import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const buildOnlyDatabaseUrl =
  'mysql://prisma:prisma@127.0.0.1:3306/event_registration';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? buildOnlyDatabaseUrl,
  },
});
