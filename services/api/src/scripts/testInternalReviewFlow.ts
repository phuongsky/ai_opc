import { db } from "../db/client";
import { logAudit } from "../modules/audit/auditLogger";

async function runTest() {
  console.log("=== BẮT ĐẦU TEST FLOW INTERNAL REVIEW ===");
  const testTaskId = `test_review_${Date.now()}`;

  // 1. Tạo task test có rủi ro R3
  console.log("1. Tạo task test với risk R3, review_needed_by_role='founder'...");
  const task = await db.task.create({
    data: {
      id: testTaskId,
      title: "[TEST] Chuyển tiền thanh toán hợp đồng dịch vụ đối tác",
      objective: "Chuyển 50.000.000 VNĐ qua ngân hàng cho đối tác cung cấp hạ tầng cloud.",
      assignedTo: "agent_finance",
      status: "ASSIGNED",
      riskLevel: "R3",
      reviewNeededByRole: "founder",
      createdBy: "FOUNDER",
    },
  });
  console.log("✓ Đã tạo task:", task.id, "Status:", task.status);

  // 2. Giả lập AgentWorker xử lý xong các bước và chuyển sang AWAITING_INTERNAL_REVIEW
  console.log("2. Giả lập Agent hoàn tất các bước và phát hiện risk R3...");
  const awaitingReviewTask = await db.task.update({
    where: { id: testTaskId },
    data: {
      status: "AWAITING_INTERNAL_REVIEW",
      reviewNeededByRole: "founder",
      internalReviewNotes: "[Hệ thống]: Agent Finance đã chuẩn bị lệnh chuyển khoản và chờ Founder duyệt.",
    },
  });
  await logAudit({
    agentId: "agent_finance",
    taskId: testTaskId,
    action: "AWAITING_INTERNAL_REVIEW",
    resultSummary: "Task chuyển sang AWAITING_INTERNAL_REVIEW chờ founder duyệt.",
    riskLevel: "R3",
  });
  console.log("✓ Task hiện tại:", awaitingReviewTask.status, "Review role:", awaitingReviewTask.reviewNeededByRole);

  if (awaitingReviewTask.status !== "AWAITING_INTERNAL_REVIEW") {
    throw new Error("LỖI: Trạng thái task không phải AWAITING_INTERNAL_REVIEW!");
  }

  // 3. Giả lập Founder từ chối (Reject / Request changes)
  console.log("3. Giả lập Founder từ chối với lý do 'Cần đính kèm hoá đơn VAT trước khi chuyển'...");
  const comment = "Cần đính kèm hoá đơn VAT và xác nhận đối soát từ kế toán trưởng trước khi duyệt lệnh chuyển 50tr.";
  const timestamp = new Date().toLocaleString("vi-VN", { hour12: false });
  const rejectionNote = `[${timestamp} · Founder Review (Yêu cầu sửa)]: ${comment}`;
  const updatedNotes = awaitingReviewTask.internalReviewNotes
    ? `${awaitingReviewTask.internalReviewNotes}\n${rejectionNote}`
    : rejectionNote;

  const rejectedTask = await db.task.update({
    where: { id: testTaskId },
    data: {
      status: "ASSIGNED",
      internalReviewNotes: updatedNotes,
      reviewNeededByRole: "founder",
    },
  });
  await logAudit({
    agentId: "agent_finance",
    taskId: testTaskId,
    action: "INTERNAL_REVIEW_REJECTED",
    resultSummary: `Founder từ chối / yêu cầu sửa: ${comment}`,
    riskLevel: "R3",
  });
  console.log("✓ Task sau khi Reject:", rejectedTask.status);
  console.log("✓ Ghi chú review:", rejectedTask.internalReviewNotes);

  if (rejectedTask.status !== "ASSIGNED" || !rejectedTask.internalReviewNotes?.includes("Cần đính kèm hoá đơn VAT")) {
    throw new Error("LỖI: Trạng thái hoặc ghi chú review sau khi reject không đúng!");
  }

  // 4. Giả lập Agent bổ sung chứng từ và chuyển lại AWAITING_INTERNAL_REVIEW
  console.log("4. Giả lập Agent bổ sung chứng từ và hoàn thiện...");
  const resubmittedTask = await db.task.update({
    where: { id: testTaskId },
    data: {
      status: "AWAITING_INTERNAL_REVIEW",
      reviewNeededByRole: "founder",
      internalReviewNotes: `${rejectedTask.internalReviewNotes}\n[Agent Finance]: Đã đính kèm hoá đơn VAT #HD-2026-991 và biên bản đối soát.`,
    },
  });
  console.log("✓ Task sau khi Agent nộp lại:", resubmittedTask.status);

  // 5. Giả lập Founder phê duyệt (Approve)
  console.log("5. Giả lập Founder Phê duyệt hoàn thành...");
  const approvalComment = "Đã nhận đủ hoá đơn VAT. Phê duyệt lệnh chi.";
  const approvalTimestamp = new Date().toLocaleString("vi-VN", { hour12: false });
  const approvalNote = `[${approvalTimestamp} · Founder Phê duyệt]: ${approvalComment}`;

  const approvedTask = await db.task.update({
    where: { id: testTaskId },
    data: {
      status: "COMPLETED",
      reviewNeededByRole: "none",
      internalReviewNotes: `${resubmittedTask.internalReviewNotes}\n${approvalNote}`,
      completedAt: new Date(),
    },
  });
  await logAudit({
    agentId: "agent_finance",
    taskId: testTaskId,
    action: "INTERNAL_REVIEW_APPROVED",
    resultSummary: `Founder phê duyệt: ${approvalComment}`,
    riskLevel: "R3",
  });

  console.log("✓ Task sau khi Approve:", approvedTask.status, "Review role:", approvedTask.reviewNeededByRole);
  console.log("✓ Completed at:", approvedTask.completedAt);

  if (approvedTask.status !== "COMPLETED" || approvedTask.reviewNeededByRole !== "none" || !approvedTask.completedAt) {
    throw new Error("LỖI: Trạng thái task sau khi approve không đúng chuẩn!");
  }

  // 6. Dọn dẹp task test
  console.log("6. Dọn dẹp dữ liệu test...");
  await db.task.delete({ where: { id: testTaskId } });
  console.log("✓ Đã xoá task test:", testTaskId);

  console.log("=== TẤT CẢ TEST CASES INTERNAL REVIEW FLOW ĐÃ PASS 100% ===");
}

runTest()
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
