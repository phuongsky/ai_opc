/**
 * requireAuth middleware — đảm bảo mọi route nghiệp vụ đều có JWT hợp lệ.
 * Chấp nhận token từ 2 nguồn (theo thứ tự):
 *   1. HttpOnly cookie "token" (Web — được set bởi server khi login).
 *   2. Header "Authorization: Bearer <token>" (Desktop / Mobile / API client).
 *
 * Pending-2FA token (có claim `pending2fa: true`) bị REJECT — chỉ dùng được
 * cho POST /api/auth/verify-2fa, không được dùng để gọi API nghiệp vụ.
 */
import type { Request, Response, NextFunction } from "express";
import { verifyToken, type JwtPayload } from "../modules/auth/authService";

export interface AuthedRequest extends Request {
  founder?: JwtPayload;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  // 1. Thử lấy từ cookie (Web)
  let token: string | undefined = req.cookies?.token;

  // 2. Fallback sang Authorization header (Desktop/Mobile)
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    res.status(401).json({ error: "Chưa đăng nhập — cần JWT hợp lệ." });
    return;
  }

  try {
    const payload = verifyToken(token);
    if (payload.pending2fa) {
      // Pending token chỉ dùng cho /verify-2fa — không cho route khác
      res.status(401).json({ error: "Xác thực chưa hoàn tất — vui lòng hoàn tất bước 2FA." });
      return;
    }
    req.founder = payload;
    next();
  } catch {
    res.status(401).json({ error: "Token không hợp lệ hoặc đã hết hạn." });
  }
}
