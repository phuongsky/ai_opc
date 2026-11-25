import fs from "fs";
import path from "path";
import { db } from "../../db/client";
import { hashPassword } from "./authService";
import { resolveDataDir } from "../../config/env";
import { DEFAULT_FOUNDER_EMAIL } from "../../db/bootstrapFounder";
import type { RbacRoleId } from "@ai-opc/shared";
import { logAudit } from "../audit/auditLogger";

export interface SystemAccount {
  id: string;
  email: string;
  fullName: string;
  role: RbacRoleId;
  status: "active" | "locked";
  totpEnabled: boolean;
  createdAt: string;
  isPrimaryFounder: boolean;
}

interface AccountMetaRecord {
  id: string;
  email: string;
  fullName?: string;
  role: RbacRoleId;
  status?: "active" | "locked";
  updatedAt?: string;
}

function getMetaFilePath(): string {
  const dataDir = resolveDataDir();
  return path.join(dataDir, "accounts_meta.json");
}

function readAccountsMeta(): Record<string, AccountMetaRecord> {
  const filePath = getMetaFilePath();
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw);
    } catch (err) {
      console.warn("[accountService] Lỗi đọc accounts_meta.json:", err);
    }
  }
  return {};
}

function writeAccountsMeta(metaMap: Record<string, AccountMetaRecord>): void {
  const filePath = getMetaFilePath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(metaMap, null, 2), "utf-8");
  } catch (err) {
    console.error("[accountService] Lỗi ghi accounts_meta.json:", err);
  }
}

/**
 * Lấy vai trò của một tài khoản theo email
 */
export async function getAccountRoleByEmail(email: string): Promise<RbacRoleId> {
  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail === DEFAULT_FOUNDER_EMAIL.toLowerCase()) {
    return "founder";
  }

  const metaMap = readAccountsMeta();
  for (const record of Object.values(metaMap)) {
    if (record.email?.toLowerCase() === cleanEmail) {
      return record.role || "operator";
    }
  }

  return "operator";
}

/**
 * Lấy toàn bộ danh sách tài khoản hệ thống kèm vai trò RBAC
 */
export async function listSystemAccounts(): Promise<SystemAccount[]> {
  const founders = await db.founder.findMany({
    select: {
      id: true,
      email: true,
      totpEnabled: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const metaMap = readAccountsMeta();
  let hasMetaUpdates = false;

  const result: SystemAccount[] = founders.map((f: any) => {
    const isPrimary = f.email.toLowerCase() === DEFAULT_FOUNDER_EMAIL.toLowerCase();
    const meta = metaMap[f.id] || Object.values(metaMap).find((m) => m.email.toLowerCase() === f.email.toLowerCase());

    const role: RbacRoleId = isPrimary ? "founder" : (meta?.role || "operator");
    const fullName = meta?.fullName || (isPrimary ? "Founder (Super Admin)" : f.email.split("@")[0]);
    const status = meta?.status || "active";

    if (!metaMap[f.id]) {
      metaMap[f.id] = {
        id: f.id,
        email: f.email,
        fullName,
        role,
        status,
        updatedAt: new Date().toISOString(),
      };
      hasMetaUpdates = true;
    }

    return {
      id: f.id,
      email: f.email,
      fullName,
      role,
      status,
      totpEnabled: Boolean(f.totpEnabled),
      createdAt: f.createdAt ? new Date(f.createdAt).toISOString() : new Date().toISOString(),
      isPrimaryFounder: isPrimary,
    };
  });

  if (hasMetaUpdates) {
    writeAccountsMeta(metaMap);
  }

  // Ưu tiên đưa Founder chính lên đầu
  result.sort((a, b) => {
    if (a.isPrimaryFounder) return -1;
    if (b.isPrimaryFounder) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return result;
}

/**
 * Tạo mới tài khoản người dùng
 */
export async function createSystemAccount(data: {
  email: string;
  password: string;
  fullName?: string;
  role?: RbacRoleId;
}): Promise<SystemAccount> {
  const cleanEmail = data.email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) {
    throw new Error("Địa chỉ email không hợp lệ.");
  }
  if (!data.password || data.password.trim().length < 6) {
    throw new Error("Mật khẩu phải có ít nhất 6 ký tự.");
  }

  // Kiểm tra trùng lặp email
  const existing = await db.founder.findUnique({
    where: { email: cleanEmail },
  });
  if (existing) {
    throw new Error(`Email "${cleanEmail}" đã tồn tại trong hệ thống.`);
  }

  const role: RbacRoleId = data.role || "operator";
  const fullName = data.fullName?.trim() || cleanEmail.split("@")[0];
  const passwordHash = await hashPassword(data.password);
  const id = `user_${Math.random().toString(36).substring(2, 10)}`;

  const created = await db.founder.create({
    data: {
      id,
      email: cleanEmail,
      passwordHash,
      totpEnabled: false,
    },
  });

  const metaMap = readAccountsMeta();
  metaMap[id] = {
    id,
    email: cleanEmail,
    fullName,
    role,
    status: "active",
    updatedAt: new Date().toISOString(),
  };
  writeAccountsMeta(metaMap);

  await logAudit({
    action: "SYSTEM_ACCOUNT_CREATED",
    resultSummary: `Tạo mới tài khoản thành công: Email=${cleanEmail}, Tên=${fullName}, Role=${role}`,
    riskLevel: "R2",
  });

  return {
    id: created.id,
    email: created.email,
    fullName,
    role,
    status: "active",
    totpEnabled: false,
    createdAt: new Date().toISOString(),
    isPrimaryFounder: false,
  };
}

/**
 * Cập nhật vai trò / thông tin tài khoản
 */
export async function updateSystemAccount(
  id: string,
  data: { role?: RbacRoleId; fullName?: string; status?: "active" | "locked" }
): Promise<SystemAccount> {
  const target = await db.founder.findUnique({ where: { id } });
  if (!target) {
    throw new Error("Không tìm thấy tài khoản để cập nhật.");
  }

  const isPrimary = target.email.toLowerCase() === DEFAULT_FOUNDER_EMAIL.toLowerCase();
  if (isPrimary && data.role && data.role !== "founder") {
    throw new Error("Không thể thay đổi vai trò của Founder quản trị tối cao.");
  }
  if (isPrimary && data.status === "locked") {
    throw new Error("Không thể tạm khóa tài khoản Founder quản trị tối cao.");
  }

  const metaMap = readAccountsMeta();
  const existingMeta = metaMap[id] || {
    id,
    email: target.email,
    fullName: target.email.split("@")[0],
    role: isPrimary ? "founder" : "operator",
    status: "active",
  };

  const updatedMeta: AccountMetaRecord = {
    ...existingMeta,
    fullName: data.fullName !== undefined ? data.fullName.trim() : existingMeta.fullName,
    role: isPrimary ? "founder" : (data.role || existingMeta.role),
    status: isPrimary ? "active" : (data.status || existingMeta.status),
    updatedAt: new Date().toISOString(),
  };

  metaMap[id] = updatedMeta;
  writeAccountsMeta(metaMap);

  await logAudit({
    action: "SYSTEM_ACCOUNT_UPDATED",
    resultSummary: `Cập nhật tài khoản ${target.email}: Role=${updatedMeta.role}, Status=${updatedMeta.status}`,
    riskLevel: "R2",
  });

  return {
    id: target.id,
    email: target.email,
    fullName: updatedMeta.fullName || target.email.split("@")[0],
    role: updatedMeta.role,
    status: updatedMeta.status || "active",
    totpEnabled: Boolean(target.totpEnabled),
    createdAt: target.createdAt ? new Date(target.createdAt).toISOString() : new Date().toISOString(),
    isPrimaryFounder: isPrimary,
  };
}

/**
 * Đặt lại mật khẩu tài khoản
 */
export async function resetSystemAccountPassword(
  id: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  if (!newPassword || newPassword.trim().length < 6) {
    throw new Error("Mật khẩu mới phải có ít nhất 6 ký tự.");
  }

  const target = await db.founder.findUnique({ where: { id } });
  if (!target) {
    throw new Error("Không tìm thấy tài khoản.");
  }

  const passwordHash = await hashPassword(newPassword.trim());
  await db.founder.update({
    where: { id },
    data: {
      passwordHash,
      totpEnabled: false,
      totpSecret: null,
    },
  });

  await logAudit({
    action: "SYSTEM_ACCOUNT_PASSWORD_RESET",
    resultSummary: `Đặt lại mật khẩu cho tài khoản: ${target.email}`,
    riskLevel: "R2",
  });

  return {
    success: true,
    message: `Đã đổi mật khẩu cho tài khoản ${target.email} thành công!`,
  };
}

/**
 * Xóa tài khoản người dùng
 */
export async function deleteSystemAccount(id: string): Promise<{ success: boolean; message: string }> {
  const target = await db.founder.findUnique({ where: { id } });
  if (!target) {
    throw new Error("Không tìm thấy tài khoản để xóa.");
  }

  if (target.email.toLowerCase() === DEFAULT_FOUNDER_EMAIL.toLowerCase()) {
    throw new Error("Không thể xóa tài khoản Founder quản trị tối cao của hệ thống!");
  }

  await db.founder.delete({ where: { id } });

  const metaMap = readAccountsMeta();
  delete metaMap[id];
  writeAccountsMeta(metaMap);

  await logAudit({
    action: "SYSTEM_ACCOUNT_DELETED",
    resultSummary: `Đã xóa tài khoản người dùng: ${target.email}`,
    riskLevel: "R3",
  });

  return {
    success: true,
    message: `Đã xóa tài khoản ${target.email} thành công!`,
  };
}
