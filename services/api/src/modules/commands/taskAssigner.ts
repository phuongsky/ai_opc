/**
 * Direct Task Assigner — phân giải lệnh `/do <việc cụ thể>` của Founder:
 * - Nhận diện Agent đích (qua @mention, prefix hoặc phân tích từ khóa nhiệm vụ)
 * - Tạo Task ở trạng thái ASSIGNED trực tiếp, bỏ qua bước phân rã COO
 * - Phát WebSocket event và kích hoạt Agent Worker xử lý ngay
 */
import { randomUUID } from "crypto";
import { db } from "../../db/client";
import { broadcastCompanyEvent } from "../../ws/gateway";
import { logAudit } from "../audit/auditLogger";

interface AssignResult {
  taskId: string;
  title: string;
  objective: string;
  assignedTo: string;
  agentName: string;
  riskLevel: string;
}

const AGENT_KEYWORDS: Record<string, string[]> = {
  agent_tech: [
    "code", "bug", "lỗi", "fix", "deploy", "server", "database", "db",
    "api", "backend", "frontend", "git", "infra", "hạ tầng", "sql", "migration", "test"
  ],
  agent_marketing: [
    "marketing", "content", "bài viết", "blog", "seo", "quảng cáo", "ads",
    "social", "facebook", "tiktok", "banner", "chiến dịch", "viral", "copywriting"
  ],
  agent_sales: [
    "sales", "bán hàng", "lead", "khách hàng", "deal", "báo giá", "pipeline",
    "crm", "tư vấn", "hợp đồng", "chốt sale", "outreach"
  ],
  agent_finance: [
    "finance", "tài chính", "tiền", "ngân sách", "chi phí", "thu chi",
    "hoá đơn", "invoice", "bank", "chuyển khoản", "lợi nhuận", "báo cáo tài chính", "kế toán"
  ],
  agent_product: [
    "product", "sản phẩm", "tính năng", "feature", "roadmap", "spec",
    "tài liệu", "nghiên cứu", "khảo sát", "benchmark", "đối thủ"
  ],
  agent_sunright_hotel: [
    "hotel", "khách sạn", "sunright", "phòng", "đặt phòng", "booking", "room",
    "checkin", "check-in", "checkout", "check-out", "lưu trú", "deluxe", "standard",
    "suite", "reservation", "đơn đặt phòng", "khách", "intelio",
    "doanh thu phòng", "doanh thu khách sạn", "báo cáo doanh thu", "báo cáo ngày",
    "doanh thu hàng ngày", "khách nghỉ qua đêm", "minibar", "giặt ủi", "nhà hàng",
    "foc", "f.o.c", "phòng foc", "danh sách foc", "free of charge", "miễn phí phòng", "phòng miễn phí",
    "sinh nhật", "sinh nhat", "birthday", "danh sách sinh nhật", "khách sinh nhật", "sn",
    "tình trạng phòng", "thống kê tình trạng phòng", "thống kê phòng", "room status", "phòng trống", "phòng dơ", "phòng khóa",
    "ăn sáng", "khách ăn sáng", "báo cáo ăn sáng", "báo cáo khách ăn sáng", "danh sách ăn sáng", "breakfast", "điểm tâm",
    "ngày khách", "ngay khach", "lượt khách", "luot khach", "thống kê ngày khách", "thống kê lượt khách", "bảng thống kê ngày khách", "guest days", "guest stats",
    "thống kê số lượng khách, lượng phòng", "thống kê lượng khách, lượng phòng", "thống kê lượng phòng", "room night count report", "room night count", "lượng khách, lượng phòng", "lượng khách lượng phòng", "số lượng khách, lượng phòng",
    "báo cáo phụ thu thêm giường", "phụ thu thêm giường", "phụ thu giường", "thêm giường", "extra bed", "phụ thu pax",
    "báo cáo dự kiến kinh doanh", "dự kiến kinh doanh", "dự báo kinh doanh", "báo cáo dự báo kinh doanh", "dự báo kinh doanh chi tiết", "business forecast",
    "khách dự kiến đi", "khách dự kiến trả phòng", "khách dự kiến đi trong ngày", "khách dự kiến đi hôm nay", "khách dự kiến trả phòng hôm nay",
    "dự kiến đi", "dự kiến trả phòng", "dự kiến đi trong ngày", "dự kiến đi hôm nay", "dự kiến trả phòng hôm nay",
    "du kien di", "du kien tra phong", "khach du kien di", "khach du kien tra phong", "expected departures", "departures",
    "khách dự kiến đến", "khách dự kiến tới", "khách dự kiến nhận phòng", "khách dự kiến đến hôm nay", "khách dự kiến đến trong ngày",
    "dự kiến đến", "dự kiến tới", "dự kiến nhận phòng", "dự kiến checkin", "dự kiến check-in",
    "du kien den", "du kien toi", "khach du kien den", "khach du kien toi", "expected arrivals", "arrivals"
  ],
  agent_hotel: [
    "hotel", "khách sạn", "sunright", "phòng", "đặt phòng", "booking", "room",
    "checkin", "check-in", "checkout", "check-out", "lưu trú", "deluxe", "standard",
    "suite", "reservation", "đơn đặt phòng", "khách", "intelio",
    "doanh thu phòng", "doanh thu khách sạn", "báo cáo doanh thu", "báo cáo ngày",
    "doanh thu hàng ngày", "khách nghỉ qua đêm", "minibar", "giặt ủi", "nhà hàng",
    "foc", "f.o.c", "phòng foc", "danh sách foc", "free of charge", "miễn phí phòng", "phòng miễn phí",
    "sinh nhật", "sinh nhat", "birthday", "danh sách sinh nhật", "khách sinh nhật", "sn",
    "tình trạng phòng", "thống kê tình trạng phòng", "thống kê phòng", "room status", "phòng trống", "phòng dơ", "phòng khóa",
    "ăn sáng", "khách ăn sáng", "báo cáo ăn sáng", "báo cáo khách ăn sáng", "danh sách ăn sáng", "breakfast", "điểm tâm",
    "ngày khách", "ngay khach", "lượt khách", "luot khach", "thống kê ngày khách", "thống kê lượt khách", "bảng thống kê ngày khách", "guest days", "guest stats",
    "thống kê số lượng khách, lượng phòng", "thống kê lượng khách, lượng phòng", "thống kê lượng phòng", "room night count report", "room night count", "lượng khách, lượng phòng", "lượng khách lượng phòng", "số lượng khách, lượng phòng",
    "báo cáo phụ thu thêm giường", "phụ thu thêm giường", "phụ thu giường", "thêm giường", "extra bed", "phụ thu pax",
    "báo cáo dự kiến kinh doanh", "dự kiến kinh doanh", "dự báo kinh doanh", "báo cáo dự báo kinh doanh", "dự báo kinh doanh chi tiết", "business forecast",
    "khách dự kiến đi", "khách dự kiến trả phòng", "khách dự kiến đi trong ngày", "khách dự kiến đi hôm nay", "khách dự kiến trả phòng hôm nay",
    "dự kiến đi", "dự kiến trả phòng", "dự kiến đi trong ngày", "dự kiến đi hôm nay", "dự kiến trả phòng hôm nay",
    "du kien di", "du kien tra phong", "khach du kien di", "khach du kien tra phong", "expected departures", "departures",
    "khách dự kiến đến", "khách dự kiến tới", "khách dự kiến nhận phòng", "khách dự kiến đến hôm nay", "khách dự kiến đến trong ngày",
    "dự kiến đến", "dự kiến tới", "dự kiến nhận phòng", "dự kiến checkin", "dự kiến check-in",
    "du kien den", "du kien toi", "khach du kien den", "khach du kien toi", "expected arrivals", "arrivals"
  ],
};

const AGENT_ALIAS: Record<string, string> = {
  "@tech": "agent_tech",
  "@ai_tech": "agent_tech",
  "@engineering": "agent_tech",
  "@marketing": "agent_marketing",
  "@ai_marketing": "agent_marketing",
  "@cmo": "agent_marketing",
  "@sales": "agent_sales",
  "@ai_sales": "agent_sales",
  "@cro": "agent_sales",
  "@finance": "agent_finance",
  "@ai_finance": "agent_finance",
  "@cfo": "agent_finance",
  "@product": "agent_product",
  "@ai_product": "agent_product",
  "@cpo": "agent_product",
  "@coo": "ai_coo",
  "@ai_coo": "ai_coo",
  "@hotel": "agent_sunright_hotel",
  "@sunright": "agent_sunright_hotel",
  "@ai_sunright": "agent_sunright_hotel",
  "@sunright_hotel": "agent_sunright_hotel",
  "@booking": "agent_sunright_hotel",
  "@ai_booking": "agent_sunright_hotel",
};

export async function handleDirectDoCommand(
  rawArgument: string,
  context?: { origin?: string; originId?: string | number }
): Promise<AssignResult> {
  const argument = rawArgument.trim();
  if (!argument) {
    throw new Error("Vui lòng nhập nội dung công việc sau lệnh /do (ví dụ: /do @tech Sửa lỗi kết nối DB)");
  }

  // 1. Lấy danh sách Agents trong DB
  const allAgents = await db.agent.findMany();
  const agentMap = new Map<string, { id: string; name: string; title: string; mission: string; active: boolean; status: string; suspendedReason: string | null }>(
    allAgents.map((a: any) => [a.id, a])
  );
  
  const activeAgents = allAgents.filter(
    (a: { active: boolean; status: string; suspendedReason: string | null }) => 
      a.active && a.status !== "SUSPENDED" && a.suspendedReason !== "FIRED_BY_FOUNDER"
  );
  const activeAgentMap = new Map(activeAgents.map((a: { id: string }) => [a.id, a]));
  const activeAgentIds = new Set(activeAgents.map((a: { id: string }) => a.id));

  let targetAgentId: string | null = null;
  let cleanObjective = argument;
  let explicitlyTargetedFiredAgent: { id: string; name: string; suspendedReason: string | null } | null = null;

  // 2. Kiểm tra @mention ở đầu câu
  const firstWord = argument.split(/\s+/)[0]?.toLowerCase();
  if (firstWord && firstWord.startsWith("@")) {
    const rawMention = firstWord.slice(1);
    const normalizedMention = rawMention.replace(/[^a-z0-9]/g, "");

    // 2a. Khớp trực tiếp Agent ID ĐANG HOẠT ĐỘNG
    if (activeAgentMap.has(rawMention)) {
      targetAgentId = rawMention;
      cleanObjective = argument.slice(firstWord.length).trim();
    }
    // 2b. Khớp Agent ID bỏ prefix 'agent_' trên Active Agents (ví dụ: @tech -> agent_tech, @hotel -> agent_hotel)
    else if (activeAgentMap.has(`agent_${rawMention}`)) {
      targetAgentId = `agent_${rawMention}`;
      cleanObjective = argument.slice(firstWord.length).trim();
    }
    // 2c. Khớp theo Tên hiển thị (Name) / Title của các Active Agents (ví dụ: @AI-Hotel, @HotelManager)
    else {
      const matchedActive = activeAgents.find((a: { id: string; name: string; title: string }) => {
        const normName = a.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        const normId = a.id.toLowerCase().replace(/[^a-z0-9]/g, "");
        const normTitle = (a.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        return (
          normName === normalizedMention ||
          normId === normalizedMention ||
          normName.includes(normalizedMention) ||
          normId.includes(normalizedMention) ||
          normTitle.includes(normalizedMention)
        );
      });

      if (matchedActive) {
        targetAgentId = matchedActive.id;
        cleanObjective = argument.slice(firstWord.length).trim();
      }
      // 2d. Khớp bí danh tĩnh (AGENT_ALIAS) — CHỈ ÁP DỤNG NẾU AGENT ĐÍCH ĐANG ACTIVE
      else if (AGENT_ALIAS[firstWord]) {
        const candidateId = AGENT_ALIAS[firstWord];
        if (activeAgentMap.has(candidateId)) {
          targetAgentId = candidateId;
          cleanObjective = argument.slice(firstWord.length).trim();
        } else {
          // Agent mặc định đã bị sa thải / tạm dừng ➔ Tìm xem có Active Agent nào khác cùng nghiệp vụ không
          const alternativeActive = activeAgents.find((a: { id: string; name: string; title: string; mission: string }) => {
            const fullText = `${a.id} ${a.name} ${a.title || ""} ${a.mission || ""}`.toLowerCase();
            return fullText.includes(normalizedMention) || fullText.includes(rawMention);
          });

          if (alternativeActive) {
            targetAgentId = alternativeActive.id;
            cleanObjective = argument.slice(firstWord.length).trim();
          } else {
            // Không còn Agent chuyên trách nào đang active ➔ Chuyển thẳng về AI-COO xử lý
            targetAgentId = "ai_coo";
            cleanObjective = argument.slice(firstWord.length).trim();
          }
        }
      }
      // 2e. Nếu gõ đích danh ID của Agent đã bị sa thải mà không có ai thay thế
      else if (agentMap.has(rawMention) && !activeAgentMap.has(rawMention)) {
        explicitlyTargetedFiredAgent = agentMap.get(rawMention)!;
      } else if (agentMap.has(`agent_${rawMention}`) && !activeAgentMap.has(`agent_${rawMention}`)) {
        explicitlyTargetedFiredAgent = agentMap.get(`agent_${rawMention}`)!;
      }
    }
  }

  // 3. Kiểm tra prefix như "tech:", "sales:", "hotel:", hoặc "<tên agent>:"
  if (!targetAgentId && !explicitlyTargetedFiredAgent) {
    const colonIndex = argument.indexOf(":");
    if (colonIndex > 0 && colonIndex < 30) {
      const prefix = argument.slice(0, colonIndex).trim().toLowerCase();
      const normPrefix = prefix.replace(/[^a-z0-9]/g, "");

      if (activeAgentMap.has(prefix)) {
        targetAgentId = prefix;
        cleanObjective = argument.slice(colonIndex + 1).trim();
      } else if (activeAgentMap.has(`agent_${prefix}`)) {
        targetAgentId = `agent_${prefix}`;
        cleanObjective = argument.slice(colonIndex + 1).trim();
      } else {
        const matchedActive = activeAgents.find((a: { id: string; name: string; title: string }) => {
          const normName = a.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          const normId = a.id.toLowerCase().replace(/[^a-z0-9]/g, "");
          return normName === normPrefix || normId === normPrefix || normName.includes(normPrefix);
        });

        if (matchedActive) {
          targetAgentId = matchedActive.id;
          cleanObjective = argument.slice(colonIndex + 1).trim();
        } else {
          const matchedAlias = AGENT_ALIAS[`@${prefix}`];
          if (matchedAlias && activeAgentMap.has(matchedAlias)) {
            targetAgentId = matchedAlias;
            cleanObjective = argument.slice(colonIndex + 1).trim();
          }
        }
      }
    }
  }

  // Nếu người dùng cố tình gõ chính xác ID của một Agent đã bị sa thải
  if (explicitlyTargetedFiredAgent && !targetAgentId) {
    const reasonText = explicitlyTargetedFiredAgent.suspendedReason === "FIRED_BY_FOUNDER"
      ? "ĐÃ BỊ SA THẢI bởi Founder"
      : `ĐANG TẠM DỪNG (${explicitlyTargetedFiredAgent.suspendedReason || "SUSPENDED"})`;
    throw new Error(
      `⚠️ AI Agent "${explicitlyTargetedFiredAgent.name}" (@${explicitlyTargetedFiredAgent.id}) hiện ${reasonText}. Vui lòng tạo Agent mới hoặc vào /agents để tái kích hoạt (Rehire).`
    );
  }

  // 4. Nếu chưa chỉ định agent cụ thể, phân tích từ khóa nội dung (CHỈ XÉT AGENT ĐANG HOẠT ĐỘNG)
  if (!targetAgentId) {
    const lowerObj = cleanObjective.toLowerCase();
    let bestMatchScore = 0;

    // Quét qua các active agents
    for (const agent of activeAgents) {
      if (agent.id === "ai_coo") continue; // AI-COO là fallback sau cùng

      let score = 0;
      // 4a. Từ khóa có sẵn trong cấu hình
      const staticKw = AGENT_KEYWORDS[agent.id] || [];
      for (const kw of staticKw) {
        if (lowerObj.includes(kw)) score += 2;
      }

      // 4b. Từ khóa động trích xuất từ Name, Title, Mission của Agent
      const agentProfileWords = `${agent.name} ${agent.title || ""} ${agent.mission || ""}`
        .toLowerCase()
        .split(/[\s,./\\-_+()]+/);

      for (const word of agentProfileWords) {
        if (word.length >= 3 && lowerObj.includes(word)) {
          score += 1;
        }
      }

      if (score > bestMatchScore) {
        bestMatchScore = score;
        targetAgentId = agent.id;
      }
    }
  }

  // Fallback mặc định nếu không khớp từ khóa hoặc agent không active
  if (!targetAgentId || !activeAgentIds.has(targetAgentId)) {
    targetAgentId = "ai_coo"; // AI-COO đảm nhiệm an toàn
  }

  const assignedAgent = agentMap.get(targetAgentId) || allAgents[0];
  const taskId = `task_${randomUUID()}`;

  // Rút gọn tiêu đề task từ objective
  let title = cleanObjective;
  if (title.length > 80) {
    const periodIdx = title.indexOf(".");
    if (periodIdx > 0 && periodIdx < 80) {
      title = title.slice(0, periodIdx);
    } else {
      title = title.slice(0, 77) + "...";
    }
  }

  const createdByTag = context?.origin && context.originId
    ? `${context.origin}:${context.originId}`
    : "FOUNDER";

  // 5. Tạo Task ở trạng thái ASSIGNED
  const task = await db.task.create({
    data: {
      id: taskId,
      title: title || cleanObjective,
      objective: cleanObjective,
      assignedTo: assignedAgent.id,
      status: "ASSIGNED",
      riskLevel: "R1",
      createdBy: createdByTag,
    },
  });

  // 6. Ghi Audit Log hành động điều phối trực tiếp của Founder
  await logAudit({
    agentId: assignedAgent.id,
    taskId: task.id,
    action: "FOUNDER_DIRECT_DISPATCH",
    resultSummary: `Founder giao trực tiếp task "${task.title}" cho ${assignedAgent.name}`,
    riskLevel: "R1",
  });

  // 7. Phát sự kiện real-time qua WebSocket
  broadcastCompanyEvent({
    type: "TASK_UPDATED",
    payload: task,
  });

  return {
    taskId: task.id,
    title: task.title,
    objective: task.objective,
    assignedTo: assignedAgent.id,
    agentName: assignedAgent.name,
    riskLevel: task.riskLevel,
  };
}
