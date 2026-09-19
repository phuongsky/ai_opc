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
    "hoá đơn", "invoice", "bank", "chuyển khoản", "lợi nhuận", "doanh thu"
  ],
  agent_product: [
    "product", "sản phẩm", "tính năng", "feature", "roadmap", "spec",
    "tài liệu", "nghiên cứu", "khảo sát", "benchmark", "đối thủ"
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
};

export async function handleDirectDoCommand(rawArgument: string): Promise<AssignResult> {
  const argument = rawArgument.trim();
  if (!argument) {
    throw new Error("Vui lòng nhập nội dung công việc sau lệnh /do (ví dụ: /do @tech Sửa lỗi kết nối DB)");
  }

  // 1. Lấy danh sách Agents trong DB
  const allAgents = await db.agent.findMany();
  const agentMap = new Map(allAgents.map((a: { id: string }) => [a.id, a]));

  let targetAgentId: string | null = null;
  let cleanObjective = argument;

  // 2. Kiểm tra @mention ở đầu câu
  const firstWord = argument.split(/\s+/)[0]?.toLowerCase();
  if (firstWord && AGENT_ALIAS[firstWord]) {
    targetAgentId = AGENT_ALIAS[firstWord];
    cleanObjective = argument.slice(firstWord.length).trim();
  } else if (firstWord && firstWord.startsWith("@")) {
    const rawId = firstWord.slice(1);
    if (agentMap.has(rawId)) {
      targetAgentId = rawId;
      cleanObjective = argument.slice(firstWord.length).trim();
    }
  }

  // 3. Kiểm tra prefix như "tech:", "sales:", "marketing:"
  if (!targetAgentId) {
    const colonIndex = argument.indexOf(":");
    if (colonIndex > 0 && colonIndex < 20) {
      const prefix = argument.slice(0, colonIndex).trim().toLowerCase();
      const matchedAlias = AGENT_ALIAS[`@${prefix}`];
      if (matchedAlias) {
        targetAgentId = matchedAlias;
        cleanObjective = argument.slice(colonIndex + 1).trim();
      }
    }
  }

  // 4. Nếu chưa chỉ định agent cụ thể, phân tích từ khóa nội dung
  if (!targetAgentId) {
    const lowerObj = cleanObjective.toLowerCase();
    let bestMatchScore = 0;

    for (const [agentId, keywords] of Object.entries(AGENT_KEYWORDS)) {
      let score = 0;
      for (const kw of keywords) {
        if (lowerObj.includes(kw)) score++;
      }
      if (score > bestMatchScore) {
        bestMatchScore = score;
        targetAgentId = agentId;
      }
    }
  }

  // Fallback mặc định nếu không khớp từ khóa
  if (!targetAgentId || !agentMap.has(targetAgentId)) {
    targetAgentId = "ai_coo"; // AI-COO đảm nhiệm hoặc phân bổ
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

  // 5. Tạo Task ở trạng thái ASSIGNED
  const task = await db.task.create({
    data: {
      id: taskId,
      title: title || cleanObjective,
      objective: cleanObjective,
      assignedTo: assignedAgent.id,
      status: "ASSIGNED",
      riskLevel: "R1",
      createdBy: "FOUNDER",
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
