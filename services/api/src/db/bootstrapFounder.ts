/**
 * Script khởi tạo tài khoản Founder duy nhất.
 * Chạy 1 lần duy nhất sau khi migrate DB:
 *
 *   pnpm bootstrap:founder -- founder@mycompany.com "MatKhauManh123!"
 *
 * Nếu Founder đã tồn tại → cập nhật password (cho phép reset).
 */
import { db } from "./client";
import { hashPassword } from "../modules/auth/authService";

async function main() {
  const [, , email, password] = process.argv;

  if (!email || !password) {
    console.error("Cách dùng: pnpm bootstrap:founder -- <email> <password>");
    console.error('Ví dụ:     pnpm bootstrap:founder -- founder@co.com "MatKhauManh123!"');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Mật khẩu phải có ít nhất 8 ký tự.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  const founder = await db.founder.upsert({
    where: { id: "founder_1" },
    update: { email, passwordHash },
    create: { id: "founder_1", email, passwordHash },
  });

  console.log(`✅ Founder tạo/cập nhật thành công!`);
  console.log(`   Email: ${founder.email}`);
  console.log(`   2FA:   ${founder.totpEnabled ? "bật" : "chưa bật"}`);
  console.log(`\nBước tiếp theo:`);
  console.log(`   1. Mở http://localhost:3000 → đăng nhập với email/password vừa tạo.`);
  console.log(`   2. Vào /security để bật 2FA (khuyến nghị trước khi dùng thật).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
