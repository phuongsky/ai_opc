/**
 * Script khởi tạo / cập nhật tài khoản Founder.
 * Chạy:
 *   pnpm bootstrap:founder
 * hoặc:
 *   pnpm bootstrap:founder -- phuongtv2c11@gmail.com "MatKhauManh123!"
 *
 * Nếu Founder đã tồn tại → cập nhật password (cho phép reset và đăng nhập thành công).
 */
import { db } from "./client";
import { hashPassword } from "../modules/auth/authService";

export const DEFAULT_FOUNDER_EMAIL = "phuongtv2c11@gmail.com";
export const DEFAULT_FOUNDER_PASSWORD = "MatKhauManh123!";

/**
 * Đảm bảo tài khoản Founder luôn tồn tại với mật khẩu hợp lệ (Self-Healing).
 * Được gọi tự động mỗi khi server backend khởi động (kể cả trên bản Desktop sidecar .exe).
 */
export async function ensureFounderAccount(
  targetEmail?: string,
  targetPassword?: string,
  resetTotp = false
) {
  const email = targetEmail || DEFAULT_FOUNDER_EMAIL;
  const password = targetPassword || DEFAULT_FOUNDER_PASSWORD;

  const passwordHash = await hashPassword(password);

  // 1. Kiểm tra nếu đã có Founder với email này trong DB
  const existingByEmail = await db.founder.findUnique({
    where: { email },
  });

  let founder;

  if (existingByEmail) {
    // Nếu chưa có passwordHash hợp lệ (hoặc rỗng) hoặc được yêu cầu reset
    const needsPasswordUpdate =
      !existingByEmail.passwordHash ||
      existingByEmail.passwordHash.length < 10 ||
      Boolean(targetPassword);

    const updateData: any = {};
    if (needsPasswordUpdate) {
      updateData.passwordHash = passwordHash;
    }
    if (resetTotp) {
      updateData.totpEnabled = false;
      updateData.totpSecret = null;
    }

    if (Object.keys(updateData).length > 0) {
      founder = await db.founder.update({
        where: { id: existingByEmail.id },
        data: updateData,
      });
      console.log(`[bootstrap] Đã cập nhật mật khẩu hợp lệ cho Founder ${email}.`);
    } else {
      founder = existingByEmail;
    }

    // Nếu còn bản ghi mẫu cũ founder@mycompany.com khác, dọn dẹp để tránh xung đột
    try {
      await db.founder.deleteMany({
        where: {
          email: "founder@mycompany.com",
          id: { not: existingByEmail.id },
        },
      });
    } catch {}
  } else {
    // 2. Kiểm tra nếu có bản ghi founder_1 (ví dụ founder@mycompany.com), ta đổi email và cập nhật password
    const existingDefault = await db.founder.findUnique({
      where: { id: "founder_1" },
    });

    if (existingDefault) {
      founder = await db.founder.update({
        where: { id: "founder_1" },
        data: { email, passwordHash, ...(resetTotp ? { totpEnabled: false, totpSecret: null } : {}) },
      });
      console.log(`[bootstrap] Đã chuyển đổi founder_1 sang email ${email}.`);
    } else {
      founder = await db.founder.create({
        data: { id: "founder_1", email, passwordHash, totpEnabled: false },
      });
      console.log(`[bootstrap] Đã khởi tạo Founder ${email} thành công.`);
    }
  }

  return founder;
}

async function main() {
  const [, , argEmail, argPassword] = process.argv;

  const email = argEmail || DEFAULT_FOUNDER_EMAIL;
  const password = argPassword || DEFAULT_FOUNDER_PASSWORD;

  if (password.length < 8) {
    console.error("Mật khẩu phải có ít nhất 8 ký tự.");
    process.exit(1);
  }

  const founder = await ensureFounderAccount(email, password, true);

  console.log(`✅ Founder tạo/cập nhật thành công!`);
  console.log(`   Email: ${founder.email}`);
  console.log(`   2FA:   ${founder.totpEnabled ? "bật" : "chưa bật"}`);
  console.log(`\nBước tiếp theo:`);
  console.log(`   1. Mở http://localhost:3000 → đăng nhập với email/password:`);
  console.log(`      Email:    ${founder.email}`);
  console.log(`      Password: ${password}`);
  console.log(`   2. Vào /security để quản lý 2FA (nếu cần).`);
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
