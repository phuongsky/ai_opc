import { db } from "../db/client";
import { issueSessionToken } from "../modules/auth/authService";

async function run() {
  console.log("=== BẮT ĐẦU KIỂM THỬ MOVE ALL TASKS TO TRASH ===");

  const timestamp = Date.now();
  const id1 = `test_trash_${timestamp}_1`;
  const id2 = `test_trash_${timestamp}_2`;

  // 1. Tạo 2 task mẫu với trạng thái NEW và ASSIGNED
  const task1 = await db.task.create({
    data: {
      id: id1,
      title: "Test Task 1 for Trash All",
      objective: "Mục tiêu kiểm thử tính năng dọn dẹp Kanban 1",
      status: "NEW",
      riskLevel: "R1",
      createdBy: "test_suite",
    },
  });

  const task2 = await db.task.create({
    data: {
      id: id2,
      title: "Test Task 2 for Trash All",
      objective: "Mục tiêu kiểm thử tính năng dọn dẹp Kanban 2",
      status: "ASSIGNED",
      riskLevel: "R0",
      createdBy: "test_suite",
    },
  });

  console.log(`✓ Đã tạo 2 task thử nghiệm: ${task1.id}, ${task2.id}`);

  // 2. Tạo Founder JWT Token
  const token = issueSessionToken(
    { id: "founder-test", email: "founder@ai-opc.local" },
    true,
    "founder"
  );

  // 3. Gọi endpoint POST /api/tasks/trash/all
  const apiUrl = "http://127.0.0.1:8000/api/tasks/trash/all";
  console.log(`Đang gửi yêu cầu tới ${apiUrl}...`);

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API trả về lỗi ${response.status}: ${errorText}`);
  }

  const result = (await response.json()) as any;
  console.log("✓ Kết quả phản hồi từ API:", result);

  if (result.status !== "OK" || typeof result.count !== "number" || result.count < 2) {
    throw new Error(`Kết quả không như kỳ vọng: ${JSON.stringify(result)}`);
  }

  // 4. Kiểm tra trong cơ sở dữ liệu xem 2 task đã chuyển sang TRASH chưa
  const reloadedTask1 = await db.task.findUnique({ where: { id: task1.id } });
  const reloadedTask2 = await db.task.findUnique({ where: { id: task2.id } });

  if (reloadedTask1?.status !== "TRASH" || reloadedTask2?.status !== "TRASH") {
    throw new Error(
      `Trạng thái task chưa chuyển thành TRASH: task1=${reloadedTask1?.status}, task2=${reloadedTask2?.status}`
    );
  }

  console.log("✓ Đã xác minh trong DB: Cả 2 task đều đã có status = 'TRASH'");

  // 5. Dọn dẹp dữ liệu kiểm thử
  await db.task.deleteMany({
    where: { id: { in: [task1.id, task2.id] } },
  });
  console.log("✓ Đã xóa sạch dữ liệu kiểm thử tạm thời.");

  console.log("=== KIỂM THỬ HOÀN TẤT VỚI KẾT QUẢ THÀNH CÔNG ===");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Kiểm thử thất bại:", err);
    process.exit(1);
  });
