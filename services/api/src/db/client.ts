/**
 * Lớp trừu tượng chọn Prisma Client tương ứng với DB_PROVIDER trong .env.
 * Nghiệp vụ (modules/*) KHÔNG import trực tiếp @prisma/client — luôn import
 * `db` từ file này, để đổi engine (postgres/sqlite/mssql) không đụng code.
 *
 * Lưu ý: mỗi provider có output client riêng (xem schema.*.prisma), nên phải
 * chạy `db:generate` tương ứng trước khi build/dev với provider đó.
 */
import { env } from "../config/env";

// eslint-disable-next-line @typescript-eslint/no-var-requires
function loadPrismaClient() {
  switch (env.dbProvider) {
    case "sqlite": {
      const { PrismaClient } = require("../../node_modules/.prisma/client-sqlite");
      return new PrismaClient({ datasourceUrl: env.databaseUrl });
    }
    case "sqlserver": {
      const { PrismaClient } = require("../../node_modules/.prisma/client-mssql");
      return new PrismaClient({ datasourceUrl: env.databaseUrl });
    }
    case "postgresql":
    default: {
      const { PrismaClient } = require("@prisma/client");
      return new PrismaClient({ datasourceUrl: env.databaseUrl });
    }
  }
}

export const db = loadPrismaClient();
