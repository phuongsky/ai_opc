/**
 * requireTotpForHighRisk middleware — enforce 2FA cho hành động rủi ro cao.
 * Áp dụng trên: POST /api/decisions/:id/approve
 *
 * Nếu decision có riskLevel R3 hoặc R4:
 *   - Founder chưa bật 2FA → 403 (phải bật trước tại /security).
 *   - Đã bật nhưng không có / sai header X-TOTP-Code → 401.
 *   - Đúng mã → tiếp tục.
 *
 * Đây là bản thực thi tầng code của nguyên tắc "Founder Approval" (Governance
 * Model mục 4.3) — không thể bỏ qua bằng cách gọi thẳng API.
 */
import type { Response, NextFunction } from "express";
import type { AuthedRequest } from "./requireAuth";
import { db } from "../db/client";
import { verifyTotpCode } from "../modules/auth/twoFactorService";

const HIGH_RISK = new Set(["R3", "R4"]);

export async function requireTotpForHighRisk(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { id } = req.params;

  const decision = await db.decisionPackage.findUnique({ where: { id } });
  if (!decision) {
    // Không tồn tại → để route handler trả 404 — không phải lỗi auth
    next();
    return;
  }

  // Chỉ áp 2FA gate cho R3/R4
  if (!HIGH_RISK.has(decision.riskLevel)) {
    next();
    return;
  }

  const founder = await db.founder.findUnique({ where: { id: req.founder!.sub } });
  if (!founder) {
    res.status(401).json({ error: "Founder không tồn tại." });
    return;
  }

  if (!founder.totpEnabled || !founder.totpSecret) {
    res.status(403).json({
      error: "Quyết định rủi ro cao (R3/R4) yêu cầu bật 2FA trước. Vào /security để thiết lập.",
      code: "2FA_NOT_ENABLED",
    });
    return;
  }

  const totpCode = (req.headers["x-totp-code"] as string | undefined)?.trim();
  if (!totpCode) {
    res.status(401).json({
      error: "Thiếu header X-TOTP-Code — cung cấp mã 6 số từ Authenticator app.",
      code: "TOTP_REQUIRED",
    });
    return;
  }

  if (!verifyTotpCode(founder.totpSecret, totpCode)) {
    res.status(401).json({ error: "Mã 2FA không đúng hoặc đã hết hạn.", code: "TOTP_INVALID" });
    return;
  }

  next();
}
