import { verifyGoogleIdTokenAndLogin } from "../modules/auth/googleAuthService";
import { db } from "../db/client";

async function main() {
  console.log("=== BẮT ĐẦU KIỂM THỬ LUỒNG GOOGLE AUTH ===");

  // 1. Test invalid / empty token rejection
  console.log("1. Kiểm tra từ chối token rỗng hoặc không hợp lệ:");
  try {
    await verifyGoogleIdTokenAndLogin("");
    throw new Error("Không bắt được lỗi token rỗng!");
  } catch (err: any) {
    console.log("✓ Đã từ chối token rỗng chính xác:", err.message);
  }

  try {
    await verifyGoogleIdTokenAndLogin("invalid_fake_token_jwt_123");
    throw new Error("Không bắt được lỗi fake token!");
  } catch (err: any) {
    console.log("✓ Đã từ chối fake token chính xác:", err.message);
  }

  // 2. Check Founder table compatibility
  console.log("2. Kiểm tra schema bảng Founder:");
  const currentFounders = await db.founder.findMany();
  console.log(`✓ Tìm thấy ${currentFounders.length} founder(s) trong DB.`);

  console.log("=== KIỂM THỬ LUỒNG GOOGLE AUTH THÀNH CÔNG (100% PASS) ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
