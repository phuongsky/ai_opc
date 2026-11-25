/**
 * External Data Source Client — kết nối tới 1 database NGOÀI hệ thống (vd:
 * database nghiệp vụ của khách sạn 'hotel_dbs'), TÁCH BIỆT hoàn toàn với
 * DATABASE_URL (DB vận hành nội bộ AI-OPC: agents/tasks/audit_logs...).
 *
 * Dùng Knex.js làm query builder — Agent/LLM KHÔNG được tự ghép chuỗi SQL thô,
 * mọi câu lệnh đều build qua Knex (parameterized, chống SQL injection).
 *
 * SQL Server dùng connection OBJECT (ổn định hơn nhiều so với connection
 * string qua driver `tedious`) — cấu hình qua các biến rời trong .env:
 *   DATASOURCE_HOTEL_DBS_ENGINE=sqlserver
 *   DATASOURCE_HOTEL_DBS_HOST=your-server-host
 *   DATASOURCE_HOTEL_DBS_PORT=1433
 *   DATASOURCE_HOTEL_DBS_DATABASE=hotel_dbs
 *   DATASOURCE_HOTEL_DBS_USER=sa
 *   DATASOURCE_HOTEL_DBS_PASSWORD=...
 *   DATASOURCE_HOTEL_DBS_ENCRYPT=true          # false nếu SQL Server nội bộ không SSL
 *   DATASOURCE_HOTEL_DBS_TRUST_CERT=true        # true khi dùng chứng chỉ tự ký / môi trường local
 */
import knex, { Knex } from "knex";
import os from "os";
import fs from "fs";
import path from "path";
import { resolveDataDir } from "../../config/env";
import type { ExternalDbConfig, ExternalDbEngine } from "@ai-opc/shared";

export type { ExternalDbEngine };

const clientCache = new Map<string, Knex>();

const DB_ALIASES: Record<string, string> = {
  hotel_dbs: "hotel_sunright",
  hotel_sunright: "hotel_dbs",
};

function readEnv(name: string, key: string): string | undefined {
  const direct = process.env[`DATASOURCE_${name.toUpperCase()}_${key}`];
  if (direct !== undefined && direct.trim() !== "") return direct.trim();
  const alias = DB_ALIASES[name.toLowerCase()];
  if (alias) {
    const aliasVal = process.env[`DATASOURCE_${alias.toUpperCase()}_${key}`];
    if (aliasVal !== undefined && aliasVal.trim() !== "") return aliasVal.trim();
  }
  return undefined;
}

function isSnapshotPath(p: string): boolean {
  if (!p) return true;
  const lower = p.toLowerCase();
  return (
    lower.includes("snapshot") ||
    lower.startsWith("/snapshot") ||
    lower.startsWith("\\snapshot") ||
    lower.includes(":\\snapshot")
  );
}

function getSafeEnvFilePaths(): string[] {
  const paths: string[] = [];

  // 1. Luôn ưu tiên user writable data directory (cho Desktop App & Packaged Binary)
  try {
    const userEnv = path.join(resolveDataDir(), ".env");
    if (!isSnapshotPath(userEnv)) {
      paths.push(userEnv);
    }
  } catch {}

  // 2. Nếu đang chạy trong môi trường Dev (không phải pkg standalone), cập nhật local .env nếu tồn tại
  const isPackaged = Boolean((process as any).pkg) || !process.execPath.toLowerCase().endsWith("node.exe");
  if (!isPackaged) {
    const devCandidates = [
      path.resolve(process.cwd(), ".env"),
      path.resolve(__dirname, "../../../.env"),
      path.resolve(__dirname, "../../.env"),
    ];
    for (const cand of devCandidates) {
      if (!isSnapshotPath(cand)) {
        try {
          if (fs.existsSync(cand)) {
            paths.push(cand);
          }
        } catch {}
      }
    }
  }

  return Array.from(new Set(paths));
}

function updateEnvFile(filePath: string, updates: Record<string, string>) {
  if (isSnapshotPath(filePath)) return;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(filePath)) {
      const content = Object.entries(updates)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
      fs.writeFileSync(filePath, content + "\n", "utf-8");
      return;
    }

    let content = fs.readFileSync(filePath, "utf-8");
    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^#?\\s*${key}=.*$`, "m");
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`);
      } else {
        content += `\n${key}=${value}`;
      }
    }
    fs.writeFileSync(filePath, content, "utf-8");
  } catch (err: any) {
    console.warn(`[externalDbClient] Không thể ghi file cấu hình ${filePath} (bỏ qua):`, err?.message || err);
  }
}

export function getExternalDbConfig(name: string = "hotel_dbs"): ExternalDbConfig {
  const engine = (readEnv(name, "ENGINE") || "sqlserver").toLowerCase() as ExternalDbEngine;
  const host = readEnv(name, "HOST") || "127.0.0.1";
  const defaultPort = engine === "postgresql" ? 5432 : engine === "mysql" ? 3306 : 1433;
  const port = Number(readEnv(name, "PORT") || defaultPort);
  const database = readEnv(name, "DATABASE") || "";
  const user = readEnv(name, "USER") || "";
  const rawPass = readEnv(name, "PASSWORD");
  const encrypt = (readEnv(name, "ENCRYPT") || "false").toLowerCase() === "true";
  const trustServerCertificate = (readEnv(name, "TRUST_CERT") || "true").toLowerCase() === "true";

  return {
    engine,
    host,
    port,
    database,
    user,
    passwordMasked: rawPass ? "••••••••" : "",
    encrypt,
    trustServerCertificate,
    isConfigured: Boolean(host && database && user),
  };
}

export function updateExternalDbConfig(
  name: string = "hotel_dbs",
  config: Partial<ExternalDbConfig>
): ExternalDbConfig {
  const current = getExternalDbConfig(name);
  const engine = (config.engine || current.engine || "sqlserver").toLowerCase() as ExternalDbEngine;
  const host = config.host !== undefined ? config.host.trim() : current.host;
  const port = config.port !== undefined ? Number(config.port) : current.port;
  const database = config.database !== undefined ? config.database.trim() : current.database;
  const user = config.user !== undefined ? config.user.trim() : current.user;
  const encrypt = config.encrypt !== undefined ? Boolean(config.encrypt) : current.encrypt;
  const trustServerCertificate =
    config.trustServerCertificate !== undefined
      ? Boolean(config.trustServerCertificate)
      : current.trustServerCertificate;

  const prefix = `DATASOURCE_${name.toUpperCase()}_`;
  const updates: Record<string, string> = {
    [`${prefix}ENGINE`]: engine,
    [`${prefix}HOST`]: host,
    [`${prefix}PORT`]: String(port),
    [`${prefix}DATABASE`]: database,
    [`${prefix}USER`]: user,
    [`${prefix}ENCRYPT`]: String(encrypt),
    [`${prefix}TRUST_CERT`]: String(trustServerCertificate),
  };

  // Cập nhật cả alias nếu có (vd: HOTEL_SUNRIGHT)
  const alias = DB_ALIASES[name.toLowerCase()];
  if (alias) {
    const aliasPrefix = `DATASOURCE_${alias.toUpperCase()}_`;
    updates[`${aliasPrefix}ENGINE`] = engine;
    updates[`${aliasPrefix}HOST`] = host;
    updates[`${aliasPrefix}PORT`] = String(port);
    updates[`${aliasPrefix}DATABASE`] = database;
    updates[`${aliasPrefix}USER`] = user;
    updates[`${aliasPrefix}ENCRYPT`] = String(encrypt);
    updates[`${aliasPrefix}TRUST_CERT`] = String(trustServerCertificate);
  }

  // Mật khẩu: chỉ cập nhật nếu người dùng cung cấp mật khẩu mới (khác rỗng và không phải chuỗi mask)
  if (config.password && config.password.trim() !== "" && config.password !== "••••••••") {
    updates[`${prefix}PASSWORD`] = config.password;
    if (alias) {
      updates[`DATASOURCE_${alias.toUpperCase()}_PASSWORD`] = config.password;
    }
  }

  // 1. Cập nhật process.env trong bộ nhớ
  for (const [k, v] of Object.entries(updates)) {
    process.env[k] = v;
  }

  // 2. Lưu an toàn vào các tệp .env hợp lệ (bỏ qua ổ đĩa ảo snapshot của pkg)
  const safePaths = getSafeEnvFilePaths();
  for (const p of safePaths) {
    updateEnvFile(p, updates);
  }

  // 3. Xóa cache kết nối Knex cũ để Agent tự động kết nối mới
  const existing = clientCache.get(name);
  if (existing) {
    try {
      existing.destroy();
    } catch {}
    clientCache.delete(name);
  }
  if (alias && clientCache.has(alias)) {
    try {
      clientCache.get(alias)!.destroy();
    } catch {}
    clientCache.delete(alias);
  }
  clientCache.clear();

  console.log(`[externalDbClient] ✓ Đã cập nhật cấu hình Database "${name}" (${engine} - ${database}@${host}:${port})`);

  return getExternalDbConfig(name);
}

export async function testExternalDbConnection(config?: Partial<ExternalDbConfig>): Promise<{
  success: boolean;
  message: string;
  version?: string;
  latencyMs?: number;
  tableCount?: number;
}> {
  const current = getExternalDbConfig("hotel_dbs");
  const engine = (config?.engine || current.engine || "sqlserver").toLowerCase() as ExternalDbEngine;
  let host = config?.host !== undefined ? config.host.trim() : current.host;
  if (host.toLowerCase() === os.hostname().toLowerCase() || host.toLowerCase() === "localhost") {
    host = "127.0.0.1";
  }
  const defaultPort = engine === "postgresql" ? 5432 : engine === "mysql" ? 3306 : 1433;
  const port = Number(config?.port !== undefined ? config.port : (current.port || defaultPort));
  const database = config?.database !== undefined ? config.database.trim() : current.database;
  const user = config?.user !== undefined ? config.user.trim() : current.user;

  let password = config?.password;
  if (!password || password.trim() === "" || password === "••••••••") {
    password = readEnv("hotel_dbs", "PASSWORD") || "";
  }

  const encrypt = config?.encrypt !== undefined ? Boolean(config.encrypt) : current.encrypt;
  const trustServerCertificate =
    config?.trustServerCertificate !== undefined
      ? Boolean(config.trustServerCertificate)
      : current.trustServerCertificate;

  if (!host || !database || !user) {
    return {
      success: false,
      message: "Vui lòng nhập đầy đủ thông tin: Host, Database và Tên người dùng (User).",
    };
  }

  let testClient: Knex | null = null;
  const startTime = Date.now();

  try {
    if (engine === "sqlserver") {
      testClient = knex({
        client: "mssql",
        connection: {
          server: host,
          port,
          database,
          user,
          password,
          options: {
            encrypt,
            trustServerCertificate,
            connectTimeout: 10000,
            requestTimeout: 10000,
            enableArithAbort: true,
            rowCollectionOnDone: false,
            rowCollectionOnRequestCompletion: false,
            useColumnNames: false,
          },
        } as any,
        pool: { min: 0, max: 1 },
      });

      const res = await testClient.raw("SELECT @@VERSION as version");
      const latencyMs = Date.now() - startTime;
      const rawVersion = Array.isArray(res) ? res[0]?.version : res?.version || "Microsoft SQL Server";
      const shortVersion = String(rawVersion).split("\n")[0].trim();

      let tableCount = 0;
      try {
        const countRes = await testClient.raw(
          "SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'"
        );
        tableCount = Number(countRes?.[0]?.count ?? 0);
      } catch {}

      return {
        success: true,
        message: `Kết nối thành công tới SQL Server "${database}" tại ${host}:${port}! (${latencyMs}ms)`,
        version: shortVersion,
        latencyMs,
        tableCount,
      };
    } else if (engine === "mysql") {
      testClient = knex({
        client: "mysql2",
        connection: {
          host,
          port,
          database,
          user,
          password,
          connectTimeout: 10000,
        },
        pool: { min: 0, max: 1 },
      });

      const res = await testClient.raw("SELECT VERSION() as version");
      const latencyMs = Date.now() - startTime;
      const version = res?.[0]?.[0]?.version || "MySQL";

      let tableCount = 0;
      try {
        const countRes = await testClient.raw(
          "SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?",
          [database]
        );
        tableCount = Number(countRes?.[0]?.[0]?.count ?? 0);
      } catch {}

      return {
        success: true,
        message: `Kết nối thành công tới MySQL "${database}" tại ${host}:${port}! (${latencyMs}ms)`,
        version: `MySQL ${version}`,
        latencyMs,
        tableCount,
      };
    } else if (engine === "postgresql") {
      testClient = knex({
        client: "pg",
        connection: {
          host,
          port,
          database,
          user,
          password,
          ssl: encrypt ? { rejectUnauthorized: !trustServerCertificate } : false,
        },
        pool: { min: 0, max: 1 },
      });

      const res = await testClient.raw("SELECT version() as version");
      const latencyMs = Date.now() - startTime;
      const version = res?.rows?.[0]?.version || "PostgreSQL";
      const shortVersion = String(version).split(",")[0].trim();

      let tableCount = 0;
      try {
        const countRes = await testClient.raw(
          "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'"
        );
        tableCount = Number(countRes?.rows?.[0]?.count ?? 0);
      } catch {}

      return {
        success: true,
        message: `Kết nối thành công tới PostgreSQL "${database}" tại ${host}:${port}! (${latencyMs}ms)`,
        version: shortVersion,
        latencyMs,
        tableCount,
      };
    } else {
      return {
        success: false,
        message: `Engine "${engine}" không hợp lệ. Chỉ chấp nhận: sqlserver, mysql, postgresql.`,
      };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      success: false,
      message: `Lỗi kết nối CSDL (${latencyMs}ms): ${err.message || String(err)}`,
      latencyMs,
    };
  } finally {
    if (testClient) {
      try {
        await testClient.destroy();
      } catch {}
    }
  }
}

function buildSqlServerConnection(name: string) {
  let host = readEnv(name, "HOST") || "127.0.0.1";
  if (host.toLowerCase() === os.hostname().toLowerCase() || host.toLowerCase() === "localhost") {
    host = "127.0.0.1";
  }

  const port = Number(readEnv(name, "PORT") || 1433);
  const database = readEnv(name, "DATABASE");
  const user = readEnv(name, "USER");
  const password = readEnv(name, "PASSWORD");
  const encrypt = (readEnv(name, "ENCRYPT") || "false").toLowerCase() === "true";
  const trustServerCertificate = (readEnv(name, "TRUST_CERT") || "true").toLowerCase() === "true";

  if (!host || !database || !user || !password) {
    throw new Error(
      `Chưa cấu hình đủ SQL Server data source "${name}" — cần DATASOURCE_${name.toUpperCase()}_HOST/` +
      `DATABASE/USER/PASSWORD trong .env`
    );
  }

  return {
    server: host,
    port,
    database,
    user,
    password,
    options: {
      encrypt,
      trustServerCertificate,
      connectTimeout: 30000,
      requestTimeout: 60000,
      enableArithAbort: true,
      rowCollectionOnDone: false,
      rowCollectionOnRequestCompletion: false,
      useColumnNames: false,
    },
  } as any;
}

/**
 * Lấy Knex client cho 1 data source theo tên. SQL Server dùng connection
 * object (buildSqlServerConnection); MySQL/PostgreSQL dùng connection URL
 * đơn giản qua DATASOURCE_<TÊN>_URL nếu bạn thêm data source khác sau này.
 */
export function getExternalDb(name: string): Knex {
  if (clientCache.has(name)) return clientCache.get(name)!;

  const engine = (readEnv(name, "ENGINE") || "sqlserver").toLowerCase() as ExternalDbEngine;

  let instance: Knex;
  if (engine === "sqlserver") {
    instance = knex({
      client: "mssql",
      connection: buildSqlServerConnection(name),
      pool: {
        min: 0,
        max: 10,
        acquireTimeoutMillis: 30000,
        createTimeoutMillis: 30000,
        idleTimeoutMillis: 30000,
        reapIntervalMillis: 1000,
        createRetryIntervalMillis: 200,
      },
    });
  } else if (engine === "mysql") {
    let host = readEnv(name, "HOST") || "127.0.0.1";
    const port = Number(readEnv(name, "PORT") || 3306);
    const database = readEnv(name, "DATABASE");
    const user = readEnv(name, "USER");
    const password = readEnv(name, "PASSWORD");
    const url = readEnv(name, "URL");

    instance = knex({
      client: "mysql2",
      connection: url || { host, port, database, user, password },
      pool: {
        min: 0,
        max: 10,
        acquireTimeoutMillis: 30000,
        createTimeoutMillis: 30000,
        idleTimeoutMillis: 30000,
      },
    });
  } else if (engine === "postgresql") {
    let host = readEnv(name, "HOST") || "127.0.0.1";
    const port = Number(readEnv(name, "PORT") || 5432);
    const database = readEnv(name, "DATABASE");
    const user = readEnv(name, "USER");
    const password = readEnv(name, "PASSWORD");
    const url = readEnv(name, "URL");
    const encrypt = (readEnv(name, "ENCRYPT") || "false").toLowerCase() === "true";
    const trustServerCertificate = (readEnv(name, "TRUST_CERT") || "true").toLowerCase() === "true";

    instance = knex({
      client: "pg",
      connection: url || {
        host,
        port,
        database,
        user,
        password,
        ssl: encrypt ? { rejectUnauthorized: !trustServerCertificate } : false,
      },
      pool: {
        min: 0,
        max: 10,
        acquireTimeoutMillis: 30000,
        createTimeoutMillis: 30000,
        idleTimeoutMillis: 30000,
      },
    });
  } else {
    throw new Error(`Engine không hợp lệ: "${engine}". Chỉ chấp nhận: mysql | postgresql | sqlserver`);
  }

  clientCache.set(name, instance);
  return instance;
}
