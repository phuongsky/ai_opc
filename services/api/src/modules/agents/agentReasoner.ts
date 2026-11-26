/**
 * AgentReasoner — mỗi Department Agent tự "suy nghĩ" khi nhận 1 task, quyết
 * định 1 trong 3 hành động:
 *   - CALL_TOOL: cần dùng 1 tool cụ thể (chỉ được chọn trong danh sách tool
 *     mà agent này ĐÃ ĐƯỢC CẤP QUYỀN).
 *   - NONE: hoàn thành nhiệm vụ và đưa ra kết quả/tổng kết cuối cùng.
 *   - NEED_INFO: thiếu thông tin quan trọng cần Founder bổ sung.
 *
 * Hỗ trợ Multi-step Reasoning, Knowledge Base context, AI Self-Repair, và Heuristic Intent Recovery.
 */
import { db } from "../../db/client";
import { generateContent, isLlmConfigured, extractJsonObject } from "../../lib/llm";
import { recordModelCost } from "../cost/costTracker";
import { searchKnowledge, formatKnowledgeForPrompt } from "../memory/knowledgeBase";
import { lookupService } from "../lookups/lookupService";
import { isVideoAgent } from "../videos/videoAgent";
import { buildVideoSystemPrompt, buildVideoUserPrompt } from "../videos/videoPrompt";

export interface ToolStepRecord {
  step: number;
  toolId: string;
  params: Record<string, unknown>;
  resultSummary: string;
}

export type AgentAction =
  | { action: "CALL_TOOL"; toolId: string; params: Record<string, unknown> }
  | { action: "NONE"; note: string }
  | { action: "NEED_INFO"; note: string };

interface RawModelResponse {
  action?: string;
  act?: string;
  type?: string;
  status?: string;
  toolId?: string;
  tool_id?: string;
  tool?: string;
  toolName?: string;
  tool_name?: string;
  name?: string;
  params?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
  input?: Record<string, unknown>;
  note?: string;
  message?: string;
  summary?: string;
  result?: string;
  content?: string;
  explanation?: string;
  output?: string;
  error?: string;
  err?: string;
  reason?: string;
  details?: string;
  text?: string;
  reply?: string;
  response?: string;
}

export const TOOL_ALIASES: Record<string, string> = {
  tool_hotel_sunright_read: "tool_hotel_dbs_read",
  tool_hotel_dbs_read: "tool_hotel_sunright_read",
  tool_hotel_sunright_write: "tool_hotel_dbs_write",
  tool_hotel_dbs_write: "tool_hotel_sunright_write",
  tool_hotel_sunright_describe_schema: "tool_hotel_dbs_describe_schema",
  tool_hotel_dbs_describe_schema: "tool_hotel_sunright_describe_schema",
};

function normalizeRawDecision(
  raw: unknown,
  validToolIds: Set<string>
): AgentAction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const obj = raw as RawModelResponse;

  const rawAction = String(obj.action || obj.act || obj.type || obj.status || "")
    .trim()
    .toUpperCase();

  const rawToolId = String(
    obj.toolId ||
    obj.tool_id ||
    obj.tool ||
    obj.toolName ||
    obj.tool_name ||
    obj.name ||
    ""
  ).trim();

  // Tự động map tool alias nếu model gọi tên alias
  let resolvedToolId = rawToolId;
  if (resolvedToolId && !validToolIds.has(resolvedToolId)) {
    const alias = TOOL_ALIASES[resolvedToolId];
    if (alias && validToolIds.has(alias)) {
      resolvedToolId = alias;
    }
  }

  const rawParams = (obj.params ||
    obj.parameters ||
    obj.arguments ||
    obj.args ||
    obj.input ||
    {}) as Record<string, unknown>;

  const rawNote = String(
    obj.note ||
    obj.message ||
    obj.summary ||
    obj.result ||
    obj.content ||
    obj.explanation ||
    obj.output ||
    obj.error ||
    obj.err ||
    obj.reason ||
    obj.details ||
    obj.text ||
    obj.reply ||
    obj.response ||
    ""
  ).trim();

  // Nhánh 1: CALL_TOOL hoặc các biến thể gọi tool
  const isCallToolAction = [
    "CALL_TOOL",
    "TOOL",
    "CALL",
    "USE_TOOL",
    "USE",
    "EXECUTE_TOOL",
    "EXECUTE",
    "RUN",
    "INVOKE_TOOL",
    "QUERY",
    "READ",
    "SEARCH",
  ].includes(rawAction);

  // Nếu có action gọi tool HOẶC action trống nhưng đã chỉ định rõ tool hợp lệ
  if (isCallToolAction || (!rawAction && resolvedToolId && validToolIds.has(resolvedToolId))) {
    if (!resolvedToolId || !validToolIds.has(resolvedToolId)) {
      return {
        action: "NEED_INFO",
        note: `Model chọn tool không hợp lệ hoặc chưa được cấp quyền: ${rawToolId || "(trống)"}`,
      };
    }
    return {
      action: "CALL_TOOL",
      toolId: resolvedToolId,
      params: typeof rawParams === "object" && rawParams !== null ? rawParams : {},
    };
  }

  // Nhánh 2: NONE / Hoàn thành task
  const isNoneAction = [
    "NONE",
    "FINISH",
    "DONE",
    "COMPLETED",
    "COMPLETE",
    "SUCCESS",
    "END",
    "STOP",
    "REPORT",
    "ANSWER",
  ].includes(rawAction);

  if (isNoneAction) {
    return {
      action: "NONE",
      note: rawNote || "(Hoàn thành nhiệm vụ thành công)",
    };
  }

  // Nhánh 3: NEED_INFO / Cần thêm thông tin
  const isNeedInfoAction = [
    "NEED_INFO",
    "ASK",
    "QUESTION",
    "NEED_MORE_INFO",
    "BLOCKED",
    "INFO_NEEDED",
    "CLARIFICATION",
  ].includes(rawAction);

  if (isNeedInfoAction) {
    return {
      action: "NEED_INFO",
      note: rawNote || "Thiếu thông tin để xử lý task này.",
    };
  }

  // Nhánh 4: Nếu model trả về object chỉ có note/summary/message/error mà không có action
  if (!rawAction && rawNote.length > 0 && !resolvedToolId) {
    const isErrorNote = Boolean(
      obj.error ||
      obj.err ||
      rawNote.toLowerCase().includes("tool execution failed") ||
      rawNote.toLowerCase().includes("chưa được cấp quyền") ||
      rawNote.toLowerCase().includes("error")
    );
    if (isErrorNote) {
      // Bỏ qua để tầng cứu hộ recoverIntentFromTaskAndText xử lý gọi tool tự động
      return null;
    }
    return {
      action: "NONE",
      note: rawNote,
    };
  }

  return null;
}

export function getSystemTimeContext(): {
  dateIso: string;
  dateVn: string;
  timeVn: string;
  dateNumber: number;
  monthStr: string;
} {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const dateIso = `${yyyy}-${mm}-${dd}`;
  const dateVn = `${dd}/${mm}/${yyyy}`;
  const timeVn = now.toLocaleTimeString("vi-VN", { hour12: false });
  const dateNumber = Number(`${yyyy}${mm}${dd}`);
  const monthStr = `${yyyy}-${mm}`;
  return { dateIso, dateVn, timeVn, dateNumber, monthStr };
}

export function getTargetDateContext(text = ""): {
  dateIso: string;
  dateVn: string;
  timeVn: string;
  dateNumber: number;
  monthStr: string;
  isSpecificDate: boolean;
} {
  const sysTime = getSystemTimeContext();
  if (!text) return { ...sysTime, isSpecificDate: false };

  // DD/MM/YYYY hoặc DD-MM-YYYY
  const vnMatch = /(?:ngày\s*)?([0-3]?[0-9])[-/]([0-1]?[0-9])[-/](20\d\d)/i.exec(text);
  if (vnMatch) {
    const dd = vnMatch[1].padStart(2, "0");
    const mm = vnMatch[2].padStart(2, "0");
    const yyyy = vnMatch[3];
    return {
      dateIso: `${yyyy}-${mm}-${dd}`,
      dateVn: `${dd}/${mm}/${yyyy}`,
      timeVn: sysTime.timeVn,
      dateNumber: Number(`${yyyy}${mm}${dd}`),
      monthStr: `${yyyy}-${mm}`,
      isSpecificDate: true,
    };
  }

  // YYYY-MM-DD hoặc YYYY/MM/DD
  const isoMatch = /(20\d\d)[-/]([0-1]?[0-9])[-/]([0-3]?[0-9])/i.exec(text);
  if (isoMatch) {
    const yyyy = isoMatch[1];
    const mm = isoMatch[2].padStart(2, "0");
    const dd = isoMatch[3].padStart(2, "0");
    return {
      dateIso: `${yyyy}-${mm}-${dd}`,
      dateVn: `${dd}/${mm}/${yyyy}`,
      timeVn: sysTime.timeVn,
      dateNumber: Number(`${yyyy}${mm}${dd}`),
      monthStr: `${yyyy}-${mm}`,
      isSpecificDate: true,
    };
  }

  return { ...sysTime, isSpecificDate: false };
}

function detectTaskTopic(title: string, objective: string): { topicName: string; focusGuide: string } {
  const timeCtx = getTargetDateContext(`${title} ${objective}`);
  const text = `${title} ${objective}`.toLowerCase();
  if (
    text.includes("chuyển phòng") ||
    text.includes("chuyen phong") ||
    text.includes("đổi phòng") ||
    text.includes("doi phong") ||
    text.includes("room change") ||
    text.includes("room transfer") ||
    text.includes("chuyển đổi phòng") ||
    text.includes("chuyen doi phong")
  ) {
    return {
      topicName: `BÁO CÁO KHÁCH CHUYỂN PHÒNG (${timeCtx.dateVn})`,
      focusGuide:
        `Tập trung lọc và báo cáo toàn bộ các ca chuyển phòng / đổi phòng diễn ra trong ngày ${timeCtx.dateVn} (${timeCtx.dateNumber}) từ bảng nhật ký 'tbl_LogRes' (lọc where theo LogDate = ${timeCtx.dateNumber} hoặc LogText/Note chứa 'Chuyen phong', 'Chuyển', 'ChuyÓn tõ phßng', 'khach chuyen phong'). BẮT BUỘC trình bày chính xác theo mẫu chuẩn:\n` +
        `📋 **BÁO CÁO KHÁCH CHUYỂN PHÒNG HÔM NAY**\n` +
        `📅 Ngày: **${timeCtx.dateVn}**\n` +
        `🏨 Sunset Westlake Hanoi Hotel\n\n` +
        `📌 **Tổng số ca chuyển phòng: X lượt**\n\n` +
        `1. **Phòng cũ: ... ➔ Phòng mới: ...**\n` +
        `   • Mã đơn (ResCode): ...\n` +
        `   • Khách / Đoàn: ...\n` +
        `   • Công ty: ...\n` +
        `   • Thời gian chuyển: HH:mm:ss\n` +
        `   • Nhân viên thực hiện: ...\n` +
        `   • Lý do chuyển: ...\n\n` +
        `(Nếu không có ca nào, trả về: 'Ngày ${timeCtx.dateVn} không có khách chuyển phòng.' và '📌 Tổng số ca chuyển phòng: 0 lượt')`,
    };
  }
  if (
    text.includes("sinh nhật") ||
    text.includes("sinh nhat") ||
    text.includes("birthday") ||
    text.includes("khách sinh nhật")
  ) {
    return {
      topicName: "DANH SÁCH SINH NHẬT – Sunset Westlake Hanoi Hotel",
      focusGuide:
        "Tập trung lọc và báo cáo toàn bộ danh sách khách có ngày sinh nhật hôm nay (hoặc ngày được chỉ định) từ tbl_Guests kết hợp tbl_Reservations (lấy đơn đặt phòng mới nhất/đang ở), tbl_Companies, tbl_Nationality. BẮT BUỘC trình bày chính xác 100% theo mẫu chuẩn:\n" +
        "📋 **NỘI DUNG TIN NHẮN**\n\n" +
        " 🎂 **DANH SÁCH SINH NHẬT – Sunset Westlake Hanoi Hotel**\n\n" +
        " 📅 Ngày: **DD/MM/YYYY**\n\n" +
        " 👤 **Khách:** ...\\\n" +
        " 🏨 **Phòng:** ...\\\n" +
        " 🏢 **Công ty:** ...\\\n" +
        " 📅 **Ngày đến:** ...\\\n" +
        " 📅 **Ngày đi:** ...\\\n" +
        " 🎂 **Ngày sinh:** ...\\\n" +
        " 👨 **Giới tính:** ...\\\n" +
        " 🇻🇳 **Quốc tịch:** ...\n\n" +
        " 📝 **Ghi chú:**\n\n" +
        " - ...\n\n" +
        " 📌 **Tổng số phòng: X**\n" +
        "(Nếu không có khách nào sinh nhật hôm nay, trả về: 'Không có khách sinh nhật trong ngày hôm nay.' và ' 📌 **Tổng số phòng: 0**')",
    };
  }
  if (
    text.includes("foc") ||
    text.includes("f.o.c") ||
    text.includes("free of charge") ||
    text.includes("miễn phí") ||
    text.includes("0 đồng") ||
    text.includes("0đ")
  ) {
    return {
      topicName: "DANH SÁCH PHÒNG F.O.C / FREE OF CHARGE",
      focusGuide:
        "Tập trung lọc và báo cáo các phòng F.O.C (Free of Charge = phòng giá 0 đồng / miễn phí tiền phòng, NightRate = 0 hoặc TotalRate = 0 hoặc Note chứa FOC). BẮT BUỘC trình bày đúng theo mẫu chuẩn:\n" +
        "📋 DANH SÁCH PHÒNG F.O.C\n" +
        "📅 Ngày: DD/MM/YYYY\n\n" +
        "1. Phòng XXX\n" +
        "👤 Khách: ...\n" +
        "🏢 Công ty: ...\n" +
        "📅 Ngày đến: ...\n" +
        "📅 Ngày đi: ...\n" +
        "🎂 Ngày sinh: —\n" +
        "⚧ Giới tính: ...\n" +
        "🌍 Quốc tịch: ...\n" +
        "📝 Ghi chú: FOC\n\n" +
        "Tổng số phòng: X",
    };
  }
  if (
    text.includes("tình trạng phòng") ||
    text.includes("thống kê tình trạng phòng") ||
    text.includes("thống kê phòng") ||
    text.includes("room status") ||
    (text.includes("phòng") && text.includes("trong ngày"))
  ) {
    return {
      topicName: "THỐNG KÊ TÌNH TRẠNG PHÒNG TRONG NGÀY",
      focusGuide:
        "Tập trung tổng hợp THỐNG KÊ TÌNH TRẠNG PHÒNG TRONG NGÀY theo đúng mẫu chuẩn:\n" +
        "📋 **SUNSET WESTLAKE HANOI HOTEL**\\\n" +
        "**THỐNG KÊ TÌNH TRẠNG PHÒNG TRONG NGÀY**\\\n" +
        "📅 Ngày **DD/MM/YYYY**\n\n" +
        "• **Suite Twin:** 8 phòng | Khách đang ở: 0 | Check-out: 0 | Check-in: 0 | Phòng dơ: 0 | Phòng khóa: 0 | Phòng trống: 8\n\n" +
        "• **Suite DB:** 16 phòng | Khách đang ở: 1 | Check-out: 0 | Check-in: 1 | Phòng dơ: 0 | Phòng khóa: 0 | Phòng trống: 14\n\n" +
        "• **Premium:** 8 phòng | Khách đang ở: 0 | Check-out: 0 | Check-in: 0 | Phòng dơ: 0 | Phòng khóa: 0 | Phòng trống: 8\n\n" +
        "• **Classic Twin:** 8 phòng | Khách đang ở: 0 | Check-out: 0 | Check-in: 0 | Phòng dơ: 0 | Phòng khóa: 0 | Phòng trống: 8\n\n" +
        "• **Classic DB:** 7 phòng | Khách đang ở: 0 | Check-out: 0 | Check-in: 0 | Phòng dơ: 0 | Phòng khóa: 0 | Phòng trống: 7\n\n" +
        "📊 **TỔNG:** 47 phòng\\\n" +
        "👤 Khách đang ở: **...**\\\n" +
        "⬅️ Check-out: **...**\\\n" +
        "➡️ Check-in: **...**\\\n" +
        "🧹 Phòng dơ: **...**\\\n" +
        "🔒 Phòng khóa: **...**\\\n" +
        "🛏️ Phòng trống: **...**",
    };
  }
  if (
    text.includes("ăn sáng") ||
    text.includes("an sang") ||
    text.includes("breakfast") ||
    text.includes("điểm tâm") ||
    text.includes("diem tam")
  ) {
    return {
      topicName: "BÁO CÁO KHÁCH ĂN SÁNG",
      focusGuide:
        "Tập trung tổng hợp BÁO CÁO KHÁCH ĂN SÁNG theo đúng mẫu chuẩn:\n" +
        "📋 **BÁO CÁO KHÁCH ĂN SÁNG – DD/MM/YYYY**\\\n" +
        "🏨 Sunset Westlake Hanoi Hotel\n\n" +
        "Tổng số phòng: **X**\\\n" +
        "Tổng số khách: **Y**\n\n" +
        "1. Phòng 1003 – Chu Dung – 1 khách – Việt Nam – IN-HOUSE\n" +
        "2. Phòng 905 – 1 khách – 3rs A vi Thuy – Việt Nam – IN-HOUSE\n" +
        "...",
    };
  }
  if (
    text.includes("ngày khách") ||
    text.includes("ngay khach") ||
    text.includes("lượt khách") ||
    text.includes("luot khach") ||
    text.includes("guest days") ||
    text.includes("guest stats")
  ) {
    return {
      topicName: "BẢNG THỐNG KÊ NGÀY KHÁCH, LƯỢT KHÁCH",
      focusGuide:
        "Tập trung tổng hợp BẢNG THỐNG KÊ NGÀY KHÁCH, LƯỢT KHÁCH theo đúng mẫu chuẩn:\n" +
        "**SUNSET WESTLAKE HANOI HOTEL**\\\n" +
        "📋 **BẢNG THỐNG KÊ NGÀY KHÁCH, LƯỢT KHÁCH**\\\n" +
        "📅 **Tháng M/YYYY**\n\n" +
        "**Tổng cộng tháng M:**\n\n" +
        "- 🌍 Khách quốc tế: **X khách**\\\n" +
        "  • Khách mới: ...\\\n" +
        "  • Khách đang trọ: ...\n" +
        "- 🇻🇳 Khách nội địa: **Y khách**\\\n" +
        "  • Khách mới: ...\\\n" +
        "  • Khách đang trọ: ...\n" +
        "- 🏨 **Ngày khách: ...**\n" +
        "- 👥 **Lượt khách: ...**\n\n" +
        "**Chi tiết theo ngày:**\\\n" +
        "01/MM: X ngày khách – Y lượt khách\\\n" +
        "02/MM: X – Y\\\n" +
        "...\n\n" +
        "**Tổng: ... ngày khách – ... lượt khách.**",
    };
  }
  if (
    text.includes("lượng phòng") ||
    text.includes("luong phong") ||
    text.includes("lượng khách, lượng phòng") ||
    text.includes("lượng khách lượng phòng") ||
    text.includes("số lượng khách, lượng phòng") ||
    text.includes("room night count")
  ) {
    return {
      topicName: "ROOM NIGHT COUNT REPORT",
      focusGuide:
        "Tập trung xuất file PDF và tổng hợp báo cáo ROOM NIGHT COUNT REPORT (Thống kê lượng khách, lượng phòng) theo đúng mẫu chuẩn:\n" +
        "📄 **SUNSET WESTLAKE HANOI HOTEL**\\\n" +
        "📊 **ROOM NIGHT COUNT REPORT (Thống kê lượng khách, lượng phòng)**\\\n" +
        "📅 **Tháng M/YYYY**\n\n" +
        "✅ Đã xuất thành công file PDF báo cáo:\\\n" +
        "🔗 **File PDF:** [Room_Night_Count_Report_MM_YYYY.pdf](http://localhost:3001/api/reports/download/Room_Night_Count_Report_MM_YYYY.pdf)\n\n" +
        "📌 **Tổng kết tháng M/YYYY:**\\\n" +
        "• Tổng số khách (Guests): **...**\\\n" +
        "• Tổng lượng phòng (Room nights): **...**",
    };
  }
  if (
    text.includes("phụ thu thêm giường") ||
    text.includes("phu thu them giuong") ||
    text.includes("phụ thu giường") ||
    text.includes("phu thu giuong") ||
    text.includes("thêm giường") ||
    text.includes("them giuong") ||
    text.includes("extra bed") ||
    text.includes("phụ thu pax")
  ) {
    return {
      topicName: "BÁO CÁO PHỤ THU THÊM GIƯỜNG",
      focusGuide:
        "Tập trung tổng hợp BÁO CÁO PHỤ THU THÊM GIƯỜNG theo đúng mẫu chuẩn:\n" +
        "🏨 SUNSET WESTLAKE HANOI HOTEL\n" +
        "BÁO CÁO PHỤ THU THÊM GIƯỜNG\n" +
        "📅 DD/MM/YYYY\n\n" +
        "Tình trạng: Không phát sinh\n" +
        "👤 Pax: 0\n" +
        "🛏️ Thêm giường: 0\n" +
        "💰 Tổng cộng: 0",
    };
  }
  if (
    text.includes("dự kiến kinh doanh") ||
    text.includes("du kien kinh doanh") ||
    text.includes("dự báo kinh doanh") ||
    text.includes("du bao kinh doanh") ||
    text.includes("kinh doanh từ") ||
    text.includes("kinh doanh tu") ||
    text.includes("business forecast")
  ) {
    return {
      topicName: "BÁO CÁO DỰ BÁO KINH DOANH CHI TIẾT THEO NGÀY",
      focusGuide:
        "Tập trung tổng hợp BÁO CÁO DỰ BÁO KINH DOANH CHI TIẾT THEO NGÀY theo đúng mẫu chuẩn:\n" +
        "📋 **SUNSET WESTLAKE HANOI HOTEL**\\\n" +
        "**BÁO CÁO DỰ BÁO KINH DOANH CHI TIẾT THEO NGÀY**\\\n" +
        "📅 Từ ngày **DD/MM/YYYY đến DD/MM/YYYY**\n\n" +
        "**DD/MM/YYYY**\n\n" +
        "- OCC: ...\n" +
        "- Dự kiến đi: ...\n" +
        "- Đặt phòng: ...\n" +
        "- Dự kiến đến: ...\n" +
        "- Dự kiến bán: ...\n" +
        "- F.O.C: ...\n" +
        "- OOO: ...\n" +
        "- Phòng trống: ...\n" +
        "- Công suất: ...%\n" +
        "- Doanh thu: ...\n" +
        "- TB giá: ...\n\n" +
        "📊 **TỔNG**\n\n" +
        "- OCC: ...\n" +
        "- Dự kiến đi: ...\n" +
        "- Đặt phòng: ...\n" +
        "- Dự kiến đến: ...\n" +
        "- Dự kiến bán: ...\n" +
        "- F.O.C: ...\n" +
        "- OOO: ...\n" +
        "- Phòng trống: ...\n" +
        "- Công suất: ...%\n" +
        "- **Doanh thu: ...**\n" +
        "- **TB giá: ...**",
    };
  }
  if (
    text.includes("dự kiến") ||
    text.includes("du kien") ||
    text.includes("dự báo") ||
    text.includes("forecast") ||
    text.includes("expected")
  ) {
    if (text.includes("doanh thu") || text.includes("phòng") || text.includes("hotel")) {
      return {
        topicName: "BÁO CÁO DOANH THU DỰ KIẾN",
        focusGuide:
          "Tập trung tổng hợp Báo cáo doanh thu DỰ KIẾN gồm 3 phần:\n" +
          "1. I. DOANH THU PHÒNG (Dự kiến & Đang ở): Tổng số phòng có doanh thu liên quan đến hôm nay, liệt kê từng phòng kèm số tiền và mã đơn (vd: Phòng 302: 700.000đ (Mã 52557 - Dự kiến)).\n" +
          "2. 💰 TỔNG DOANH THU DỰ KIẾN: ...đ.\n" +
          "3. II. CHI TIẾT DOANH THU: 🛏️ Tiền phòng, 🍽️ Nhà hàng, 🍹 Minibar, 👕 Giặt ủi, ✈️ Travel, ➕ Khác, 🎁 Giảm giá.\n" +
          "4. III. GHI CHÚ: Số đơn đang ở (Status 3), số phòng có dữ liệu chi tiết ngày hôm nay, căn cứ tính NightRate.",
      };
    }
  }
  if (
    text.includes("doanh thu") ||
    text.includes("báo cáo doanh thu") ||
    text.includes("báo cáo ngày") ||
    text.includes("doanh thu phòng") ||
    text.includes("doanh thu hôm nay") ||
    text.includes("chi tiết phòng") ||
    text.includes("khách nghỉ qua đêm") ||
    text.includes("lượt phòng")
  ) {
    return {
      topicName: "BÁO CÁO DOANH THU HÀNG NGÀY",
      focusGuide:
        "Tập trung tổng hợp BÁO CÁO DOANH THU HÀNG NGÀY theo đúng mẫu chuẩn:\n" +
        "📱 **Tin nhắn có thể gửi trên điện thoại:**\n\n" +
        "**SUNSET WESTLAKE HANOI HOTEL**\\\n" +
        "📋 **BÁO CÁO DOANH THU HÀNG NGÀY**\\\n" +
        "📅 Ngày: **DD/MM/YYYY**\n\n" +
        "**Khách nghỉ qua đêm:** X phòng\n\n" +
        "1️⃣ **Phòng:** 1003\\\n" +
        "👤 **Tên khách:** Chu Dung\\\n" +
        "🏢 **Công ty:** W/I\\\n" +
        "📅 **Ngày đến:** DD/MM/YYYY\\\n" +
        "📅 **Ngày đi:** DD/MM/YYYY\\\n" +
        "👥 **Số người:** ...\n\n" +
        "💰 **Doanh thu:**\n\n" +
        "- Tiền phòng: ...\n" +
        "- Minibar: ...\n" +
        "- Giặt ủi: ...\n" +
        "- Nhà hàng: ...\n" +
        "- Travel: ...\n" +
        "- Khác: ...\n" +
        "- Giảm giá: ...\n" +
        "- **Tổng: ...**\n\n" +
        "**Tổng số lượt phòng đã bán: X**\\\n" +
        "**Tổng doanh thu: Y**",
    };
  }
  if (
    text.includes("confirmed") ||
    text.includes("xác nhận") ||
    text.includes("xac nhan") ||
    text.includes("đặt cọc") ||
    text.includes("dat coc")
  ) {
    return {
      topicName: "XÁC NHẬN ĐẶT PHÒNG / CONFIRMED",
      focusGuide: "Tập trung báo cáo các phòng đã được xác nhận đặt phòng (Status = 2 - Confirmed) trong ngày hôm nay, nêu rõ số phòng, mã đơn, ngày đến/ngày đi, giá phòng, trạng thái và số tiền đã đặt cọc (nếu có từ DepositAmount / DepositPaid). Đồng thời nêu thêm danh sách các phòng đã check-in hôm nay (trạng thái In-House) nếu có.",
    };
  }
  if (text.includes("hủy") || text.includes("huỷ") || text.includes("cancel")) {
    return {
      topicName: "HỦY ĐẶT PHÒNG",
      focusGuide:
        `Tập trung lọc và báo cáo toàn bộ các đơn bị hủy liên quan đến ngày hôm nay (${timeCtx.dateVn} / ${timeCtx.dateNumber}): ` +
        `bao gồm các đơn được thực hiện thao tác hủy hôm nay (nhật ký 'tbl_LogRes' có LogDate = ${timeCtx.dateNumber} hoặc LogText chứa 'Huy dat phong'/IsDelete = 1) ` +
        `hoặc các đơn có ngày đến dự kiến là hôm nay (ArrivalDate/FromDate = ${timeCtx.dateNumber}) có IsDelete = 1 hoặc IsCancel = 1 hoặc có CancellationNote. ` +
        `Trình bày chi tiết rõ ràng: Tổng số phòng bị hủy, Mã đơn (ResCode), Số phòng, Ngày đến dự kiến, Thời điểm hủy, Trạng thái (IsCancel/IsDelete), Lý do hủy (CancellationNote), Đơn giá đêm (NightRate). ` +
        `TUYỆT ĐỐI KHÔNG liệt kê các đơn hủy của ngày khác!`,
    };
  }
  if (text.includes("check-in") || text.includes("checkin") || text.includes("nhận phòng") || text.includes("đến")) {
    return {
      topicName: "CHECK-IN PHÒNG",
      focusGuide: "Tập trung báo cáo danh sách phòng Check-in theo 2 nhóm: (1) Phòng đã check-in hôm nay, (2) Phòng dự kiến check-in hôm nay. TUYỆT ĐỐI KHÔNG trả lời sang chủ đề hủy phòng!",
    };
  }
  if (text.includes("check-out") || text.includes("checkout") || text.includes("trả phòng") || text.includes("đi")) {
    return {
      topicName: "CHECK-OUT / TRẢ PHÒNG",
      focusGuide: "Tập trung báo cáo danh sách các phòng trả phòng trong ngày hôm nay.",
    };
  }
  if (text.includes("trống") || text.includes("còn phòng")) {
    return {
      topicName: "PHÒNG TRỐNG",
      focusGuide: "Tập trung đối chiếu tbl_Reservations và tbl_Rooms để báo cáo danh sách phòng còn trống.",
    };
  }
  return {
    topicName: "DỮ LIỆU KHÁCH SẠN",
    focusGuide: "Tổng kết kết quả chính xác, bám sát yêu cầu cụ thể của Founder.",
  };
}

function buildSystemPrompt(agent: { title: string; name: string; mission: string }): string {
  const timeCtx = getSystemTimeContext();
  return [
    `Bạn là ${agent.title} (${agent.name}) trong một công ty vận hành theo mô hình 'One-Person Company'.`,
    `Sứ mệnh của bạn: ${agent.mission}`,
    "",
    "THỜI GIAN HIỆN TẠI CỦA HỆ THỐNG:",
    `- Ngày hôm nay (Current Date): ${timeCtx.dateVn} (Định dạng ISO: ${timeCtx.dateIso}, Số nguyên Intelio Date: ${timeCtx.dateNumber}).`,
    `- Tháng hiện tại: ${timeCtx.monthStr}.`,
    `- Giờ hệ thống hiện tại: ${timeCtx.timeVn}.`,
    `- BẮT BUỘC: Khi người dùng nói "hôm nay", "nay", "today", bạn PHẢI hiểu là ngày ${timeCtx.dateVn} (${timeCtx.dateIso} / số nguyên ${timeCtx.dateNumber}). TUYỆT ĐỐI KHÔNG dùng ngày từ các script dump cũ (như 24/07/2026).`,
    "",
    "BẠN LÀ BỘ NÃO ĐIỀU PHỐI (ORCHESTRATOR / REASONER):",
    "- Bạn KHÔNG trực tiếp kết nối database hay tự chạy mã lệnh.",
    "- Bạn CHỈ CẦN phát lệnh JSON `{\"action\":\"CALL_TOOL\", \"toolId\":\"...\", \"params\":{...}}`.",
    "- Server Core Engine của hệ thống AI-OPC sẽ tự động thực thi truy vấn và trả lại dữ liệu thực tế 100% cho bạn ở bước tiếp theo.",
    "- TUYỆT ĐỐI KHÔNG tự nhận định hay trả về lỗi 'Tool execution failed' / 'database connection error'. Hãy luôn ra lệnh CALL_TOOL để hệ thống thực thi thay bạn!",
    "",
    "Hãy quyết định ĐÚNG 1 trong 3 hành động sau:",
    '- "CALL_TOOL": nếu cần gọi một công cụ (ví dụ: đọc DB, ghi DB, cập nhật đơn, gửi email, tìm kiếm web...) để lấy dữ liệu — CHỈ được chọn tool_id có trong danh sách được cấp quyền bên dưới kèm "params" đúng cấu trúc.',
    '- "NONE": nếu bạn đã có đủ dữ liệu từ các bước trước hoặc có thể hoàn thành bằng suy luận/soạn thảo — kèm "note" là BÁO CÁO / KẾT QUẢ HOÀN TẤT ĐẦY ĐỦ.',
    '- "NEED_INFO": nếu thiếu thông tin cơ bản từ Founder — kèm "note" giải thích ngắn gọn.',
    "",
    "QUY TRÌNH PHÊ DUYỆT RỦI RO (HUMAN-IN-THE-LOOP APPROVAL):",
    "- Khi nhiệm vụ yêu cầu TẠO MỚI, CẬP NHẬT, GHI DỮ LIỆU (Risk R3, R4): Bạn BẮT BUỘC PHẢI chọn 'CALL_TOOL' với đầy đủ tham số chi tiết. Hệ thống sẽ tự tạo Decision Package cho Founder duyệt.",
    "",
    "QUY TẮC TRUY VẤN & BÁO CÁO DỮ LIỆU KHÁCH SẠN (Database Intelio_Sunset):",
    "- Bảng 'tbl_Reservations' (đơn đặt phòng / lưu trú):",
    "  + 'FromDate' / 'ArrivalDate': Ngày khách dự kiến đến (số nguyên YYYYMMDD vd: 20260926 hoặc chuỗi 'YYYY-MM-DD', 'YYYY-MM').",
    "  + 'ToDate' / 'DepartureDate': Ngày khách đi (số nguyên YYYYMMDD).",
    "  + 'CheckInDate', 'CheckInTime': Ngày/giờ thực tế lễ tân đã bấm check-in vào phần mềm (vd: 20260926, 142841 = 14:28:41).",
    "  + 'RoomNo': Số phòng thực tế (vd: 304, 201, 506, 501, 101...). Bỏ qua các phòng ảo/nội bộ nếu có (như 9001, 9003, 9005).",
    "  + 'Status': Trạng thái phòng/đơn đặt phòng:",
    "    * Status = 1: In-House (Khách đang lưu trú tại phòng) hoặc Exp Arr.",
    "    * Status = 2: Confirmed (Đã xác nhận đặt phòng / Dự kiến đến trong ngày).",
    "    * Status = 3: Checked-In / Đặt cọc (Đã thực hiện check-in nhận phòng).",
    "    * Status = 4: Giữ chỗ, Status = 5: Đã trả phòng/hoàn tất.",
    "  + 'IsDelete', 'IsCancel': Cờ xóa / hủy đặt phòng (IsDelete = 1 hoặc IsCancel = 1 thể hiện đơn/phòng ĐÃ BỊ HỦY).",
    "  + 'CancellationNote': Ghi chú lý do hủy phòng (vd: 'Khach khong den', 'Khách đổi lịch'...).",
    "  + 'DepositPaid', 'DepositAmount', 'DepositNote': Đánh dấu đã nộp tiền cọc, số tiền cọc (vd: 500.000 VNĐ) và ghi chú cọc (bảng tbl_DepositPayment).",
    "  + 'ResCode': Mã đặt phòng, 'DepositPaid', 'TotalDue', 'TotalRate': Doanh thu và tiền cọc.",
    "- Bảng 'tbl_DepositPayment': Thông tin đặt cọc thanh toán trước (ItemID, Amount, Paid, DepositDate, Note, CustomerName).",
    "- Bảng 'tbl_Rooms': Danh sách toàn bộ phòng khách sạn (RoomNo, RoomTypeID, Floor, GuestStatus).",
    "- Bảng 'tbl_LinkGuests': Thông tin chi tiết khách ở theo từng phòng.",
    "- Bảng 'tbl_LogRes': Nhật ký thao tác đặt phòng / Check-in / Hủy phòng (LogDate, LogTime, RoomNo, LogText, Note, IsDelete).",
    "",
    "QUY TẮC XỬ LÝ THEO TỪNG LOẠI CÂU HỎI CỦA NGƯỜI DÙNG:",
    "",
    "A. KHI HỎI VỀ CONFIRMED / XÁC NHẬN ĐẶT PHÒNG ('có phòng nào đã confirmed/ xác nhận đặt phòng không'...):",
    `   - Báo cáo các phòng có trạng thái Đã xác nhận (Status: Confirmed / Status = 2 hoặc có đặt cọc) trong ngày ${timeCtx.dateVn}:`,
    `     + Số phòng (RoomNo), Mã đơn (ResCode), Ngày đến - Ngày đi, Số đêm`,
    `     + Giá phòng / Đơn giá đêm (NightRate / TotalRate, ví dụ: 1.100.000 VNĐ)`,
    `     + Trạng thái: Đã xác nhận (Confirmed)`,
    `     + Số tiền đã đặt cọc nếu có (DepositAmount / DepositPaid / Ghi chú đặt cọc, ví dụ: Tiền đặt cọc: 500.000 VNĐ)`,
    `   - Đồng thời, nêu tóm tắt danh sách các phòng khác đã thực hiện Check-in trong ngày hôm nay (trạng thái In-House).`,
    "",
    "B. KHI HỎI VỀ HỦY PHÒNG / PHÒNG HỦY ('có phòng nào hủy không', 'danh sách hủy'...):",
    `   - BẮT BUỘC CHỈ lọc và báo cáo các đơn bị hủy liên quan đến ngày hôm nay (${timeCtx.dateVn}):`,
    `     + Các đơn có thao tác hủy diễn ra hôm nay trong 'tbl_LogRes' (LogDate = ${timeCtx.dateNumber} hoặc CancelDate = ${timeCtx.dateNumber} có LogText chứa 'Huy dat phong' hoặc IsDelete = 1).`,
    `     + Hoặc các đơn có ngày đến dự kiến hôm nay (ArrivalDate/FromDate = ${timeCtx.dateNumber}) có 'IsDelete' = 1 HOẶC 'IsCancel' = 1 HOẶC có 'CancellationNote' trong 'tbl_Reservations'.`,
    `   - Báo cáo rõ ràng, chi tiết theo đúng cấu trúc chuẩn:`,
    `     Báo cáo hủy đặt phòng ngày ${timeCtx.dateVn}:`,
    `     1. Tổng số phòng bị hủy: X phòng.`,
    `     2. Chi tiết:`,
    `        - Mã đơn (ResCode): ...`,
    `        - Số phòng: ...`,
    `        - Ngày đến dự kiến: ...`,
    `        - Thời điểm hủy: ${timeCtx.dateVn} ...`,
    `        - Trạng thái: Đã hủy (IsCancel = 1) / Đã xóa (IsDelete = 1)`,
    `        - Lý do hủy: ...`,
    `        - Đơn giá đêm: ... VNĐ`,
    `   - TUYỆT ĐỐI KHÔNG liệt kê các đơn hủy của các ngày khác!`,
    `   - TUYỆT ĐỐI KHÔNG trả lời mẫu phân loại check-in khi câu hỏi là về hủy phòng!`,
    "",
    "C. KHI HỎI VỀ CHECK-IN HÔM NAY ('có phòng nào check-in ko'...):",
    `   - Phân tích dữ liệu theo 2 nhóm rõ ràng:`,
    `     1. Nhóm 1 — Phòng đã Check-in hôm nay: 'CheckInDate' = ${timeCtx.dateNumber} hoặc 'Status' = 3 (hoặc Status = 1) đã check-in ngày ${timeCtx.dateVn} (IsDelete = 0).`,
    `     2. Nhóm 2 — Phòng dự kiến Check-in hôm nay: 'ArrivalDate' / 'FromDate' = ${timeCtx.dateNumber}, 'Status' = 2 (Confirmed) hoặc 1 chưa check-in (IsDelete = 0).`,
    `   - TUYỆT ĐỐI KHÔNG trả lời sang chủ đề hủy phòng khi câu hỏi là về check-in!`,
    "",
    "D. KHI HỎI VỀ CHECK-OUT / TRẢ PHÒNG / DỰ KIẾN ĐI ('Khách dự kiến đi hôm nay', 'Khách dự kiến trả phòng hôm nay', 'khách dự kiến đi trong ngày'...):",
    `   - Báo cáo các phòng có 'DepartureDate' / 'ToDate' = ${timeCtx.dateNumber} (Status != 5, IsDelete = 0, IsCancel = 0).`,
    `   - BẮT BUỘC xuất định dạng theo mẫu sau:`,
    `     📋 **DANH SÁCH KHÁCH DỰ KIẾN ĐI NGÀY ${timeCtx.dateVn}**`,
    `     `,
    `     🏨 **Sunset Westlake Hanoi Hotel**`,
    `     `,
    `     - **Tên đoàn:** <GroupName hoặc WALK-IN>`,
    `     - **Hạng phòng:** <Hạng phòng>`,
    `     - **Phòng:** <Phòng>`,
    `     - **Ngày đến:** <DD/MM/YYYY>`,
    `     - **Ngày đi:** <DD/MM/YYYY>`,
    `     - **Số đêm:** <Số đêm>`,
    `     - **Tên khách:** <Tên khách>`,
    `     - **Công ty:** <Công ty>`,
    `     - **Quốc tịch:** <Quốc tịch>`,
    `     - **Booking ID:** <Booking ID>`,
    `     - **Ghi chú:** <Ghi chú>`,
    `     `,
    `     👤 **Tổng số khách:** X 🛏️ **Tổng số phòng:** Y 🌙 **Tổng ngày phòng:** Z`,
    "",
    "E. KHI HỎI VỀ PHÒNG TRỐNG:",
    `   - Đọc 'tbl_Reservations' và đối chiếu với 'tbl_Rooms'.`,
    "",
    "F. KHI HỎI VỀ DOANH THU PHÒNG / BÁO CÁO DOANH THU:",
    `   - Luôn gọi 'tool_hotel_dbs_read' với table 'tbl_Reservations', lọc where theo tháng '${timeCtx.monthStr}' (hoặc limit 500).`,
    `   - Dữ liệu trả về từ server đã tự động enrich các trường: RoomNo, GuestName, CompanyName, FromDate, ToDate, Nights, IOStatus, RoomRevenue, MinibarAmount, LaundryAmount, RestaurantAmount, TravelAmount, OtherAmount, DiscountAmount, TotalRevenue.`,
    `   - PHÂN BIỆT 2 TRƯỜNG HỢP XUẤT BÁO CÁO ('note'):`,
    `     1. TRƯỜNG HỢP 1 (Khi câu hỏi CÓ CHỮ 'DỰ KIẾN', 'dự báo', 'forecast'): Xuất định dạng Báo cáo Doanh thu Dự kiến gồm:`,
    `        📊 BÁO CÁO DOANH THU DỰ KIẾN NGÀY ${timeCtx.dateVn}`,
    `        I. DOANH THU PHÒNG (Dự kiến & Đang ở)`,
    `        Tổng số phòng có doanh thu liên quan đến ngày hôm nay: X phòng`,
    `        - Phòng 302: 700.000đ (Mã 52557 - Dự kiến)`,
    `        ...`,
    `        💰 TỔNG DOANH THU DỰ KIẾN: X.XXX.XXXđ`,
    `        II. CHI TIẾT DOANH THU: 🛏️ Tiền phòng, 🍽️ Nhà hàng, 🍹 Minibar, 👕 Giặt ủi, ✈️ Travel, ➕ Khác, 🎁 Giảm giá.`,
    `        III. GHI CHÚ: Số đơn Status 3, căn cứ tính NightRate.`,
    `     `,
    `     2. TRƯỜNG HỢP 2 (Khi hỏi 'doanh thu chi tiết phòng ks hôm nay', 'doanh thu chi tiết', 'báo cáo doanh thu hàng ngày' - KHÔNG CÓ CHỮ 'dự kiến'): BẮT BUỘC xuất định dạng chi tiết từng card phòng:`,
    `        * QUY TẮC BẮT BUỘC VỀ TRÌNH BÀY:`,
    `          - Mỗi dấu chấm đầu dòng (•) PHẢI NẰM TRÊN MỘT DÒNG RIÊNG BIỆT (có ký tự xuống dòng \\n). TUYỆT ĐỐI KHÔNG VIẾT CHUNG NHIỀU DẤU • TRÊN CÙNG MỘT HÀNG!`,
    `          - Trong mục 'I. KHÁCH NGHỈ QUA ĐÊM', CHỈ liệt kê các phòng khách đang ở / nghỉ qua đêm thực tế (Phòng 302, Phòng 502, Phòng 1003). TUYỆT ĐỐI KHÔNG đưa danh sách các phòng dự kiến đến (Exp Arr) vào mục này!`,
    `        `,
    `        Mẫu chuẩn BẮT BUỘC trả về trong note:`,
    `        📊 **BÁO CÁO DOANH THU HÀNG NGÀY**`,
    `        📅 **Ngày ${timeCtx.dateVn}**`,
    `        `,
    `        ━━━━━━━━━━━━━━━`,
    `        🏨 **I. KHÁCH NGHỈ QUA ĐÊM**`,
    `        ━━━━━━━━━━━━━━━`,
    `        `,
    `        **🏠 Phòng 302**`,
    `        • 👤 Khách: Không có tên`,
    `        • 🏢 Công ty: Xuan Son Travel`,
    `        • 📅 Đến: 26/09/2026`,
    `        • 📅 Đi: 27/09/2026`,
    `        • 👥 Số khách: 1`,
    `        • 🔄 I/O: I`,
    `        • 🛏️ Tiền phòng: **700.000đ**`,
    `        • 🍹 Minibar: 0đ`,
    `        • 👕 Giặt ủi: 0đ`,
    `        • 🍽️ Nhà hàng: 0đ`,
    `        • ✈️ Travel: 0đ`,
    `        • ➕ Khác: 0đ`,
    `        • 🎁 Giảm giá: 0đ`,
    `        ➡️ **TỔNG: 700.000đ**`,
    `        `,
    `        **🏠 Phòng 502**`,
    `        • 👤 Khách: Không có tên`,
    `        • 🏢 Công ty: Xuan Son Travel`,
    `        • 📅 Đến: 26/09/2026`,
    `        • 📅 Đi: 27/09/2026`,
    `        • 👥 Số khách: 1`,
    `        • 🔄 I/O: I`,
    `        • 🛏️ Tiền phòng: **700.000đ**`,
    `        • 🍹 Minibar: 0đ`,
    `        • 👕 Giặt ủi: 0đ`,
    `        • 🍽️ Nhà hàng: 0đ`,
    `        • ✈️ Travel: 0đ`,
    `        • ➕ Khác: 0đ`,
    `        • 🎁 Giảm giá: 0đ`,
    `        ➡️ **TỔNG: 700.000đ**`,
    `        `,
    `        **🏠 Phòng 1003**`,
    `        • 👤 Khách: Chu Dung`,
    `        • 🏢 Công ty: W/I`,
    `        • 📅 Đến: 06/11/2021`,
    `        • 📅 Đi: 23/09/2027`,
    `        • 👥 Số khách: 1`,
    `        • 🔄 I/O: I`,
    `        • 🛏️ Tiền phòng: **0đ**`,
    `        • 🍹 Minibar: 0đ`,
    `        • 👕 Giặt ủi: 0đ`,
    `        • 🍽️ Nhà hàng: 0đ`,
    `        • ✈️ Travel: 0đ`,
    `        • ➕ Khác: 0đ`,
    `        • 🎁 Giảm giá: 0đ`,
    `        ➡️ **TỔNG: 0đ**`,
    `        `,
    `        ━━━━━━━━━━━━━━━`,
    `        📌 **II. TỔNG KẾT**`,
    `        ━━━━━━━━━━━━━━━`,
    `        `,
    `        🏨 Tổng số lượt phòng đã bán: **3**`,
    `        `,
    `        💰 **TỔNG DOANH THU: 1.400.000đ**`,
    `        `,
    `        ⚠️ **Lưu ý:**`,
    `        Hệ thống hiện có **35 đơn đang ở (Status 3)**. Tuy nhiên, dữ liệu chi tiết trong danh sách ưu tiên ngày ${timeCtx.dateVn} hiện chỉ hiển thị **2 đơn: phòng 302 và 502** là có giá tiền, và **1 đơn: phòng 1003** tiền phòng = 0.`,
    `        Các đơn còn lại có thể đã check-out hoặc không nằm trong phạm vi truy vấn chi tiết của ngày ${timeCtx.dateVn}.`,
    `        📝 Doanh thu phòng được tính theo **NightRate của ngày hiện tại**.`,
    "",
    "G. KHI HỎI VỀ PHÒNG F.O.C / FREE OF CHARGE / MIỄN PHÍ TIỀN PHÒNG ('danh sách phòng f.o.c hôm nay', 'phòng foc', 'free of charge'...):",
    `   - BẮT BUỘC lọc các phòng F.O.C (Free of Charge = phòng có NightRate = 0 hoặc TotalRate = 0 hoặc Note chứa FOC).`,
    `   - Mẫu chuẩn BẮT BUỘC trả về trong note:`,
    `     📋 DANH SÁCH PHÒNG F.O.C`,
    `     📅 Ngày: ${timeCtx.dateVn}`,
    `     `,
    `     1. Phòng 1003`,
    `     👤 Khách: Chu Dung`,
    `     🏢 Công ty: W/I`,
    `     📅 Ngày đến: 06/11/2021`,
    `     📅 Ngày đi: 23/09/2027`,
    `     🎂 Ngày sinh: —`,
    `     ⚧ Giới tính: Nam`,
    `     🌍 Quốc tịch: Việt Nam`,
    `     📝 Ghi chú: FOC`,
    `     `,
    `     Tổng số phòng: 1`,
    "",
    "H. KHI HỎI VỀ DANH SÁCH SINH NHẬT / SINH NHẬT HÔM NAY ('danh sách khách sinh nhật hôm nay', 'sinh nhật', 'birthday', 'khách sinh nhật'...):",
    `   - BẮT BUỘC gọi tool_hotel_dbs_read với table 'tbl_Guests' (lọc where theo BirthDay: 'today' hoặc ${timeCtx.dateNumber.toString().slice(4, 8)}) hoặc 'tbl_Reservations'.`,
    `   - BẮT BUỘC xuất kết quả trong 'note' đúng 100% theo mẫu chuẩn sau (có \\\\ ở cuối các dòng thông tin để xuống dòng đẹp trên Telegram/Web):`,
    `     📋 **NỘI DUNG TIN NHẮN**`,
    `     `,
    `      🎂 **DANH SÁCH SINH NHẬT – Sunset Westlake Hanoi Hotel**`,
    `     `,
    `      📅 Ngày: **${timeCtx.dateVn}**`,
    `     `,
    `      👤 **Khách:** Nguyen Tran Hoai Anh\\`,
    `      🏨 **Phòng:** 802\\`,
    `      🏢 **Công ty:** Traveloka\\`,
    `      📅 **Ngày đến:** 29/05/2022\\`,
    `      📅 **Ngày đi:** 29/05/2022\\`,
    `      🎂 **Ngày sinh:** 29/09/1992\\`,
    `      👨 **Giới tính:** Nam\\`,
    `      🇻🇳 **Quốc tịch:** Việt Nam`,
    `     `,
    `      📝 **Ghi chú:**`,
    `     `,
    `      - Itinerary ID: 1063434283: 01 Classic`,
    `     - Credit Card: 5337 7386 0585 1003`,
    `     - Valid Until: 05/24`,
    `     - CVC: 102`,
    `     - VCC Amount: VND 605,625`,
    `     `,
    `      📌 **Tổng số phòng: 1**`,
    `     (Nếu không có khách nào sinh nhật hôm nay, hiển thị: 'Không có khách sinh nhật trong ngày hôm nay.' và ' 📌 **Tổng số phòng: 0**').`,
    "",
    "I. KHI HỎI VỀ KHÁCH CHUYỂN PHÒNG / ĐỔI PHÒNG ('khách chuyển phòng hôm nay', 'chuyển phòng', 'đổi phòng', 'room change', 'room transfer')...:",
    `   - BẮT BUỘC gọi 'tool_hotel_dbs_read' với table 'tbl_LogRes' (lọc where: { LogDate: ${timeCtx.dateNumber} } hoặc LogDate: "today").`,
    `   - Bảng 'tbl_LogRes' lưu trữ tất cả lịch sử thao tác chuyển phòng trong ngày qua trường 'LogText' (vd: 'Chuyen phong tu 803 den 903', 'ChuyÓn tõ phßng 606 ®Õn 704...') và 'Note'. Dữ liệu trả về đã được enrich đầy đủ FromRoom, ToRoom, ResCode, GuestName, CompanyName, GroupName, TransferTime, TransferReason.`,
    `   - Mẫu chuẩn BẮT BUỘC trả về trong note:`,
    `     📋 **BÁO CÁO KHÁCH CHUYỂN PHÒNG HÔM NAY**`,
    `     📅 Ngày: **${timeCtx.dateVn}**`,
    `     🏨 Sunset Westlake Hanoi Hotel`,
    `     `,
    `     📌 **Tổng số ca chuyển phòng: X lượt**`,
    `     `,
    `     1. **Phòng cũ: 803 ➔ Phòng mới: 903**`,
    `        • Mã đơn (ResCode): 52857`,
    `        • Công ty / Khách: Xuan Son Travel`,
    `        • Thời gian chuyển: 17:33:14`,
    `        • Người thực hiện: admin`,
    `        • Lý do: ...`,
    `     ...`,
    `     (Nếu không có: 'Hôm nay (${timeCtx.dateVn}) không có khách chuyển phòng.' và '📌 Tổng số ca chuyển phòng: 0 lượt').`,
    "",
    "- Khi kiểm tra Check-in / Check-out / Hủy phòng / Đặt phòng / Doanh thu / FOC / Sinh nhật / Chuyển phòng: Luôn gọi 'tool_hotel_dbs_read' (hoặc 'tool_hotel_sunright_read') với table 'tbl_Guests', 'tbl_Reservations' hoặc 'tbl_LogRes'.",
    `- BẢNG QUY ƯỚC MÃ TRẠNG THÁI PHÒNG: [${lookupService.getToolDescription("booking_status")}].`,
    "",
    "QUY TẮC BẮT BUỘC VỀ ĐỊNH DẠNG & PHẢN HỒI (RẤT QUAN TRỌNG, TUYỆT ĐỐI KHÔNG VI PHẠM):",
    '  - Output PHẢI bắt đầu bằng ký tự "{" và kết thúc bằng "}" — KHÔNG có bất kỳ ký tự hay lời dẫn nào trước/sau.',
    '  - TUYỆT ĐỐI KHÔNG chào hỏi, KHÔNG xưng "tôi"/"bạn", KHÔNG giải thích quá trình suy nghĩ ra ngoài JSON.',
    "  - KHÔNG dùng markdown ngoài JSON, KHÔNG bọc trong dấu ```.",
    "  - PHẢN HỒI KẾT QUẢ ('note') PHẢI NGẮN GỌN, TRỰC TIẾP, ĐÚNG TRỌNG TÂM: Chỉ báo cáo danh sách phòng kết quả theo đúng định dạng. TUYỆT ĐỐI KHÔNG bình luận về dữ liệu mẫu hay giải thích dài dòng.",
    `  - Nếu không có phòng nào khớp: Trả lời ngắn gọn 1 câu (Ví dụ: 'Hôm nay (${timeCtx.dateVn}) không có phòng nào bị hủy.').`,
    "",
    "VÍ DỤ MẪU CHUẨN (BẮT BUỘC TRẢ VỀ ĐÚNG ĐỊNH DẠNG):",
    "Ví dụ 1 (Đọc dữ liệu đặt phòng hoặc tra cứu doanh thu / FOC):",
    `{"action":"CALL_TOOL","toolId":"tool_hotel_dbs_read","params":{"table":"tbl_Reservations","where":{"FromDate":"${timeCtx.monthStr}"},"limit":500}}`,
    "",
    "Ví dụ 2 (Đọc danh sách tất cả các phòng):",
    '{"action":"CALL_TOOL","toolId":"tool_hotel_dbs_read","params":{"table":"tbl_Rooms","limit":200}}',
    "",
    "Ví dụ 3 (Khi hoàn tất task Check-in):",
    `{"action":"NONE","note":"Báo cáo Check-in ngày ${timeCtx.dateVn}:\\n1. Phòng đã check-in: Phòng 304 (Mã 52361 lúc 14:28:41), Phòng 302 (Mã 52548 lúc 13:58:55), Phòng 502 (Mã 52550 lúc 15:21:44)...\\n2. Phòng dự kiến check-in: Phòng 802 (Mã 52553), Phòng 406 (Mã 52555)..."}`,
    "",
    "Ví dụ 4 (Khi hoàn tất task Hủy phòng):",
    `{"action":"NONE","note":"Báo cáo hủy đặt phòng ngày ${timeCtx.dateVn}:\\n1. Tổng số phòng bị hủy: 1 phòng.\\n2. Chi tiết:\\n   - Mã đơn (ResCode): 52889\\n   - Số phòng: 806\\n   - Ngày đến dự kiến: 06/10/2026\\n   - Thời điểm hủy: ${timeCtx.dateVn} lúc 08:23:17\\n   - Trạng thái: Đã hủy (IsCancel = 1)\\n   - Lý do hủy: Khách không đến\\n   - Đơn giá đêm: 700,000 VNĐ"}`,
    "",
    "Ví dụ 5 (Khi hoàn tất task Xác nhận / Confirmed đặt phòng):",
    `{"action":"NONE","note":"Hôm nay (${timeCtx.dateVn}) có 01 phòng đã được xác nhận đặt phòng (Status: Confirmed):\\n\\n- Phòng 501 (Mã đơn: 53328)\\n  + Ngày đến: ${timeCtx.dateVn}, Ngày đi: 27/09/2026 (1 đêm)\\n  + Giá: 1.100.000 VNĐ\\n  + Trạng thái: Đã xác nhận (Confirmed)\\n  + Tiền đặt cọc đã nộp: 500.000 VNĐ (Ghi chú: Dat coc 500k)\\n\\nNgoài ra, có 03 phòng khác đã thực hiện Check-in trong ngày hôm nay (trạng thái In-House): Phòng 302, Phòng 502, Phòng 304."}`,
    "",
    "Ví dụ 6 (Khi hoàn tất task Báo cáo doanh thu chi tiết phòng hôm nay):",
    `{"action":"NONE","note":"📊 **BÁO CÁO DOANH THU HÀNG NGÀY**\\n📅 **Ngày ${timeCtx.dateVn}**\\n\\n━━━━━━━━━━━━━━━\\n🏨 **I. KHÁCH NGHỈ QUA ĐÊM**\\n━━━━━━━━━━━━━━━\\n\\n**🏠 Phòng 302**\\n• 👤 Khách: Không có tên\\n• 🏢 Công ty: Xuan Son Travel\\n• 📅 Đến: 26/09/2026\\n• 📅 Đi: 27/09/2026\\n• 👥 Số khách: 1\\n• 🔄 I/O: I\\n• 🛏️ Tiền phòng: **700.000đ**\\n• 🍹 Minibar: 0đ\\n• 👕 Giặt ủi: 0đ\\n• 🍽️ Nhà hàng: 0đ\\n• ✈️ Travel: 0đ\\n• ➕ Khác: 0đ\\n• 🎁 Giảm giá: 0đ\\n➡️ **TỔNG: 700.000đ**\\n\\n**🏠 Phòng 502**\\n• 👤 Khách: Không có tên\\n• 🏢 Công ty: Xuan Son Travel\\n• 📅 Đến: 26/09/2026\\n• 📅 Đi: 27/09/2026\\n• 👥 Số khách: 1\\n• 🔄 I/O: I\\n• 🛏️ Tiền phòng: **700.000đ**\\n• 🍹 Minibar: 0đ\\n• 👕 Giặt ủi: 0đ\\n• 🍽️ Nhà hàng: 0đ\\n• ✈️ Travel: 0đ\\n• ➕ Khác: 0đ\\n• 🎁 Giảm giá: 0đ\\n➡️ **TỔNG: 700.000đ**\\n\\n**🏠 Phòng 1003**\\n• 👤 Khách: Chu Dung\\n• 🏢 Công ty: W/I\\n• 📅 Đến: 06/11/2021\\n• 📅 Đi: 23/09/2027\\n• 👥 Số khách: 1\\n• 🔄 I/O: I\\n• 🛏️ Tiền phòng: **0đ**\\n• 🍹 Minibar: 0đ\\n• 👕 Giặt ủi: 0đ\\n• 🍽️ Nhà hàng: 0đ\\n• ✈️ Travel: 0đ\\n• ➕ Khác: 0đ\\n• 🎁 Giảm giá: 0đ\\n➡️ **TỔNG: 0đ**\\n\\n━━━━━━━━━━━━━━━\\n📌 **II. TỔNG KẾT**\\n━━━━━━━━━━━━━━━\\n\\n🏨 Tổng số lượt phòng đã bán: **3**\\n\\n💰 **TỔNG DOANH THU: 1.400.000đ**\\n\\n⚠️ **Lưu ý:**\\nHệ thống hiện có **35 đơn đang ở (Status 3)**. Tuy nhiên, dữ liệu chi tiết trong danh sách ưu tiên ngày ${timeCtx.dateVn} hiện chỉ hiển thị **2 đơn: phòng 302 và 502** là có giá tiền, và **1 đơn: phòng 1003** tiền phòng = 0.\\nCác đơn còn lại có thể đã check-out hoặc không nằm trong phạm vi truy vấn chi tiết của ngày ${timeCtx.dateVn}.\\n📝 Doanh thu phòng được tính theo **NightRate của ngày hiện tại**."}`,
    "",
    "Ví dụ 7 (Khi hoàn tất task Danh sách phòng F.O.C hôm nay):",
    `{"action":"NONE","note":"📋 DANH SÁCH PHÒNG F.O.C\\n📅 Ngày: ${timeCtx.dateVn}\\n\\n1. Phòng 1003\\n👤 Khách: Chu Dung\\n🏢 Công ty: W/I\\n📅 Ngày đến: 06/11/2021\\n📅 Ngày đi: 23/09/2027\\n🎂 Ngày sinh: —\\n⚧ Giới tính: Nam\\n🌍 Quốc tịch: Việt Nam\\n📝 Ghi chú: FOC\\n\\nTổng số phòng: 1"}`,
    "",
    "Ví dụ 8 (Khi hoàn tất task Danh sách khách sinh nhật hôm nay):",
    `{"action":"NONE","note":"📋 **NỘI DUNG TIN NHẮN**\\n\\n 🎂 **DANH SÁCH SINH NHẬT – Sunset Westlake Hanoi Hotel**\\n\\n 📅 Ngày: **${timeCtx.dateVn}**\\n\\n 👤 **Khách:** Nguyen Tran Hoai Anh\\\\\\n 🏨 **Phòng:** 802\\\\\\n 🏢 **Công ty:** Traveloka\\\\\\n 📅 **Ngày đến:** 29/05/2022\\\\\\n 📅 **Ngày đi:** 29/05/2022\\\\\\n 🎂 **Ngày sinh:** 29/09/1992\\\\\\n 👨 **Giới tính:** Nam\\\\\\n 🇻🇳 **Quốc tịch:** Việt Nam\\n\\n 📝 **Ghi chú:**\\n\\n - Itinerary ID: 1063434283: 01 Classic\\n- Credit Card: 5337 7386 0585 1003\\n- Valid Until: 05/24\\n- CVC: 102\\n- VCC Amount: VND 605,625\\n\\n 📌 **Tổng số phòng: 1**"}`,
    "",
    "Ví dụ 9 (Khi hoàn tất task Khách chuyển phòng hôm nay):",
    `{"action":"NONE","note":"📋 **BÁO CÁO KHÁCH CHUYỂN PHÒNG HÔM NAY**\\n📅 Ngày: **${timeCtx.dateVn}**\\n🏨 Sunset Westlake Hanoi Hotel\\n\\n📌 **Tổng số ca chuyển phòng: 5 lượt**\\n\\n1. **Phòng cũ: 803 ➔ Phòng mới: 903**\\n   • Mã đơn (ResCode): 52857\\n   • Công ty / Khách: Xuan Son Travel\\n   • Thời gian chuyển: 17:33:14\\n   • Người thực hiện: admin\\n\\n2. **Phòng cũ: 901 ➔ Phòng mới: 902**\\n   • Mã đơn (ResCode): 52858\\n   • Công ty / Khách: Xuan Son Travel\\n   • Thời gian chuyển: 17:06:48\\n   • Người thực hiện: admin\\n\\n3. **Phòng cũ: 903 ➔ Phòng mới: 905**\\n   • Mã đơn (ResCode): 52859\\n   • Công ty / Khách: Xuan Son Travel\\n   • Thời gian chuyển: 16:37:57\\n   • Người thực hiện: admin\\n\\n4. **Phòng cũ: 306 ➔ Phòng mới: 305**\\n   • Mã đơn (ResCode): 52854\\n   • Công ty / Khách: Xuan Son Travel\\n   • Thời gian chuyển: 15:17:13\\n   • Người thực hiện: admin\\n\\n5. **Phòng cũ: 606 ➔ Phòng mới: 704**\\n   • Mã đơn (ResCode): 53329\\n   • Đoàn / Khách: 11rs call2\\n   • Thời gian chuyển: 14:00:49\\n   • Người thực hiện: admin\\n   • Lý do: khach chuyen phong"}`,
    "",
    "Ví dụ 10 (Cần thêm thông tin cơ bản từ Founder):",
    '{"action":"NEED_INFO","note":"Cần bổ sung thêm thông tin ngày đến/ngày đi của khách hàng."}',
  ].join("\n");
}

function buildUserPrompt(
  task: { title: string; objective: string; internalReviewNotes?: string | null },
  tools: { id: string; name: string; description: string | null; riskLevel: string; permissionLevel: string }[],
  previousSteps: ToolStepRecord[],
  knowledgeContext = ""
): string {
  const timeCtx = getSystemTimeContext();
  const topicInfo = detectTaskTopic(task.title, task.objective);
  const toolList =
    tools.length > 0
      ? tools
        .map(
          (t) =>
            `- ${t.id}: ${t.name}${t.description ? ` — ${t.description}` : ""}`
        )
        .join("\n")
      : "(Agent này chưa được cấp quyền dùng tool nào)";

  const historyText =
    previousSteps.length > 0
      ? [
        "",
        "LỊCH SỬ CÁC BƯỚC ĐÃ THỰC HIỆN TRƯỚC ĐÓ CHO TASK NÀY:",
        ...previousSteps.map(
          (s) =>
            `[Bước ${s.step}] Tool '${s.toolId}': ${s.resultSummary}`
        ),
        "",
        `Hãy xem xét kỹ kết quả trên. Nếu đã đủ dữ liệu để hoàn tất công việc, hãy chọn 'NONE' và tổng kết kết quả vào 'note' đúng theo chủ đề "${topicInfo.topicName}" (${topicInfo.focusGuide}). Nếu cần thêm bước xử lý khác, hãy chọn 'CALL_TOOL'.`,
      ].join("\n")
      : "";

  const reviewNotesText = task.internalReviewNotes
    ? [
      "",
      "GHI CHÚ ĐÁNH GIÁ NỘI BỘ (REVIEWER FEEDBACK CẦN KHẮC PHỤC):",
      task.internalReviewNotes,
      "Lưu ý: Bạn phải lưu ý các nhận xét trên của Reviewer để điều chỉnh phương pháp và khắc phục triệt để.",
    ].join("\n")
    : "";

  return [
    `[Thời gian hiện tại của hệ thống: ${timeCtx.dateVn} ${timeCtx.timeVn} (Số Intelio Date: ${timeCtx.dateNumber})]`,
    `[CHỦ ĐỀ ĐỊNH HƯỚNG CỦA TASK]: ${topicInfo.topicName} — ${topicInfo.focusGuide}`,
    `Task: "${task.title}"`,
    `Mô tả chi tiết: ${task.objective}`,
    knowledgeContext,
    reviewNotesText,
    historyText,
    "",
    "Các tool bạn được phép dùng (ĐÃ ĐƯỢC CẤP QUYỀN ĐẦY ĐỦ, HÃY GỌI TOOL PHÙ HỢP):",
    toolList,
    "",
    "LƯU Ý: Trả về DUY NHẤT 1 JSON Object `{...}` theo đúng mẫu trên. KHÔNG viết lời dẫn hoặc chào hỏi.",
  ].filter(Boolean).join("\n");
}

/**
 * Tầng cứu hộ thông minh — trích xuất ý định gọi tool dựa trên nội dung task và phản hồi của model
 */
function recoverIntentFromTaskAndText(
  rawText: string,
  task: { title: string; objective: string },
  previousSteps: ToolStepRecord[],
  validToolIds: Set<string>
): AgentAction | null {
  const combined = `${task.title} ${task.objective} ${rawText}`.toLowerCase();

  // 1. Nhận diện truy vấn Database khách sạn Hotel Sunright / Intelio_Sunset
  const hotelReadToolId =
    (validToolIds.has("tool_hotel_dbs_read") && "tool_hotel_dbs_read") ||
    (validToolIds.has("tool_hotel_sunright_read") && "tool_hotel_sunright_read") ||
    (validToolIds.has("tool_db_read") && "tool_db_read") ||
    "tool_hotel_dbs_read";

  if (hotelReadToolId) {
    // 1.0 Nhận diện riêng biệt cho Chuyển phòng / Room Transfer
    if (
      combined.includes("chuyển phòng") ||
      combined.includes("chuyen phong") ||
      combined.includes("đổi phòng") ||
      combined.includes("doi phong") ||
      combined.includes("room change") ||
      combined.includes("room transfer") ||
      combined.includes("chuyển đổi phòng") ||
      combined.includes("chuyen doi phong")
    ) {
      const hasReadLogRes = previousSteps.some(
        (s) =>
          (s.toolId === "tool_hotel_dbs_read" ||
            s.toolId === "tool_hotel_sunright_read" ||
            s.toolId === "tool_db_read") &&
          s.params?.table === "tbl_LogRes"
      );
      if (!hasReadLogRes) {
        const targetDateCtx = getTargetDateContext(`${task.title} ${task.objective}`);
        return {
          action: "CALL_TOOL",
          toolId: hotelReadToolId,
          params: {
            table: "tbl_LogRes",
            where: { LogDate: targetDateCtx.dateNumber },
            limit: 200,
          },
        };
      }
    }

    const isHotelQuery =
      combined.includes("phòng") ||
      combined.includes("room") ||
      combined.includes("đặt phòng") ||
      combined.includes("reservation") ||
      combined.includes("booking") ||
      combined.includes("khách") ||
      combined.includes("guest") ||
      combined.includes("doanh thu") ||
      combined.includes("sunright") ||
      combined.includes("intelio") ||
      combined.includes("check-in") ||
      combined.includes("checkin") ||
      combined.includes("nhận phòng") ||
      combined.includes("check-out") ||
      combined.includes("checkout") ||
      combined.includes("trả phòng") ||
      combined.includes("hủy") ||
      combined.includes("huỷ") ||
      combined.includes("cancel") ||
      combined.includes("cancellation") ||
      combined.includes("confirmed") ||
      combined.includes("xác nhận") ||
      combined.includes("xac nhan") ||
      combined.includes("đặt cọc") ||
      combined.includes("dat coc") ||
      combined.includes("foc") ||
      combined.includes("f.o.c") ||
      combined.includes("free of charge") ||
      combined.includes("hôm nay") ||
      combined.includes("nay") ||
      combined.includes("today");

    if (isHotelQuery) {
      // Nếu là bước 1 hoặc chưa có bước đọc Reservations
      const hasReadReservations = previousSteps.some(
        (s) =>
          (s.toolId === "tool_hotel_dbs_read" ||
            s.toolId === "tool_hotel_sunright_read" ||
            s.toolId === "tool_db_read") &&
          (s.params?.table === "tbl_Reservations" || !s.params?.table)
      );

      // Trích xuất tháng/năm dạng 9/2026, 09/2026, 2026-09 hoặc hôm nay
      let monthParam: string | null = null;
      const monthMatch =
        /(?:tháng\s*)?([0-1]?[0-9])[-/](20\d\d)/i.exec(combined) ||
        /(20\d\d)[-/]([0-1]?[0-9])/i.exec(combined);

      if (monthMatch) {
        const p1 = monthMatch[1];
        const p2 = monthMatch[2];
        if (p1.length === 4) {
          monthParam = `${p1}-${p2.padStart(2, "0")}`;
        } else {
          monthParam = `${p2}-${p1.padStart(2, "0")}`;
        }
      } else if (
        combined.includes("hôm nay") ||
        combined.includes("nay") ||
        combined.includes("today") ||
        combined.includes("check-in") ||
        combined.includes("checkin") ||
        combined.includes("hủy") ||
        combined.includes("huỷ") ||
        combined.includes("cancel") ||
        combined.includes("confirmed") ||
        combined.includes("xác nhận") ||
        combined.includes("xac nhan") ||
        combined.includes("đặt cọc")
      ) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        monthParam = `${year}-${month}`;
      }

      if (!hasReadReservations) {
        const where: Record<string, unknown> = {};
        if (monthParam) {
          where.FromDate = monthParam;
        }
        return {
          action: "CALL_TOOL",
          toolId: hotelReadToolId,
          params: {
            table: "tbl_Reservations",
            where: Object.keys(where).length > 0 ? where : undefined,
            limit: 500,
          },
        };
      }

      // Nếu đã đọc Reservations, tiếp tục đọc tbl_Rooms để đối chiếu phòng trống
      const hasReadRooms = previousSteps.some(
        (s) =>
          (s.toolId === "tool_hotel_dbs_read" ||
            s.toolId === "tool_hotel_sunright_read" ||
            s.toolId === "tool_db_read") &&
          s.params?.table === "tbl_Rooms"
      );
      if (
        !hasReadRooms &&
        (combined.includes("phòng trống") ||
          combined.includes("danh sách phòng") ||
          combined.includes("còn trống") ||
          combined.includes("trống"))
      ) {
        return {
          action: "CALL_TOOL",
          toolId: hotelReadToolId,
          params: {
            table: "tbl_Rooms",
            limit: 200,
          },
        };
      }
    }
  }

  // 2. Nhận diện tìm kiếm web
  if (validToolIds.has("tool_web_search") && previousSteps.length === 0) {
    if (combined.includes("tìm kiếm") || combined.includes("tra cứu") || combined.includes("search") || combined.includes("google")) {
      return {
        action: "CALL_TOOL",
        toolId: "tool_web_search",
        params: { query: task.title },
      };
    }
  }

  // 3. Nhận diện gửi email
  if (validToolIds.has("tool_send_email") && (combined.includes("gửi email") || combined.includes("send mail"))) {
    const emailMatch = combined.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      return {
        action: "CALL_TOOL",
        toolId: "tool_send_email",
        params: {
          to: emailMatch[0],
          subject: task.title,
          body: task.objective,
        },
      };
    }
  }

  return null;
}

/**
 * Cho agent quyết định hành động cho 1 task (hỗ trợ multi-step history & self-repair).
 */
export async function decideAgentAction(
  agentId: string,
  task: { title: string; objective: string; internalReviewNotes?: string | null },
  previousSteps: ToolStepRecord[] = []
): Promise<AgentAction> {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new Error(`Agent không tồn tại: ${agentId}`);

  const permissions = await db.agentToolPermission.findMany({
    where: { agentId },
    include: { tool: true },
  });

  const toolOptions = permissions.map((p: { tool: { id: string; name: string; description: string | null; riskLevel: string }; permissionLevel: string }) => ({
    id: p.tool.id,
    name: p.tool.name,
    description: p.tool.description,
    riskLevel: p.tool.riskLevel,
    permissionLevel: p.permissionLevel,
  }));

  const validToolIds = new Set<string>(toolOptions.map((t: { id: string }) => t.id));

  if (!isLlmConfigured()) {
    return {
      action: "NEED_INFO",
      note: "Chưa cấu hình LLM trong .env — không thể suy nghĩ.",
    };
  }

  // Tra cứu Company Knowledge Base để Agent có ngữ cảnh kiến thức công ty
  let knowledgeContext = "";
  try {
    const knowledgeResults = await searchKnowledge(`${task.title} ${task.objective}`, 3);
    knowledgeContext = formatKnowledgeForPrompt(knowledgeResults);
  } catch (kErr) {
    console.warn("[AgentReasoner] Không thể tìm kiếm knowledge base:", kErr);
  }

  // Gọi LLM sinh quyết định
  // Agent video có prompt riêng (không mang các quy tắc khách sạn Intelio_Sunset).
  const videoMode = isVideoAgent(agentId);
  const result = await generateContent(
    videoMode ? buildVideoSystemPrompt(agent) : buildSystemPrompt(agent),
    videoMode
      ? buildVideoUserPrompt(task, toolOptions, previousSteps, knowledgeContext)
      : buildUserPrompt(task, toolOptions, previousSteps, knowledgeContext),
    { maxTokens: 4000, temperature: 0.1, jsonMode: true }
  );

  // Ghi nhận chi phí cho Department Agent
  await recordModelCost(
    agentId,
    result.usage,
    `AgentReasoner quyết định bước ${previousSteps.length + 1} cho task "${task.title.slice(0, 60)}"`
  );

  // 1. Parse JSON chuẩn
  const parsedRaw = extractJsonObject<RawModelResponse>(result.text);
  if (parsedRaw) {
    const normalized = normalizeRawDecision(parsedRaw, validToolIds);
    if (normalized) {
      return normalized;
    }
  }

  // 2. Tự động khôi phục ý định thông minh dựa trên Task & Nội dung phản hồi
  // (Bỏ qua cứu hộ theo từ khóa khách sạn với agent video: "phòng", "khách"... không liên quan.)
  const recovered = videoMode ? null : recoverIntentFromTaskAndText(result.text, task, previousSteps, validToolIds);
  if (recovered) {
    console.log(`[AgentReasoner] Đã tự động khôi phục ý định hành động cho agent ${agentId}:`, recovered);
    return recovered;
  }

  // 3. Nếu ở bước sau cùng (đã có kết quả từ các bước trước) và model trả văn bản báo cáo tự do:
  if (previousSteps.length > 0 && result.text.trim().length > 20) {
    console.log(`[AgentReasoner] Model trả văn bản tổng kết cho bước ${previousSteps.length}, tự động coi là NONE (Hoàn tất):`);
    return {
      action: "NONE",
      note: result.text.trim(),
    };
  }

  // 4. Nếu hoàn toàn không thể xử lý
  console.error(
    `[AgentReasoner] Model không trả JSON hợp lệ cho agent ${agentId}, task "${task.title}":\n`,
    result.text
  );
  return {
    action: "NEED_INFO",
    note:
      "Model không trả JSON hợp lệ (có thể do provider hiện tại trả text tự do). " +
      `Raw (200 ký tự đầu): "${result.text.slice(0, 200)}"`,
  };
}
