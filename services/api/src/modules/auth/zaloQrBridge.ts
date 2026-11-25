/**
 * zaloQrBridge.ts — Socket.io Bridge phục vụ Quét mã QR Zalo theo thời gian thực (Realtime Zalo QR Auth Gateway)
 * Tích hợp từ mã nguồn _folder/server.js vào trực tiếp API Core Engine (@ai-opc/api).
 */

import dns from "node:dns";
import fs from "fs";
import type { Server as HttpServer } from "http";
import { Server as SocketIoServer, Socket } from "socket.io";
import { Zalo } from "zca-js";
import { handleZaloWebhook, type ZaloAuthPayload } from "./zaloAuthService";
import { startZaloInboundListener } from "../notifications/zaloInbound";

// Ưu tiên phân giải IPv4 trước để tránh lỗi ETIMEDOUT (IPv6) khi kết nối Zalo Gateway
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

let ioInstance: SocketIoServer | null = null;
const activeSessions = new Map<string, { zalo: any; targetAppUrl?: string; customParams?: any }>();

export function initZaloQrBridge(httpServer: HttpServer): SocketIoServer {
  if (ioInstance) {
    return ioInstance;
  }

  const io = new SocketIoServer(httpServer, {
    path: "/socket.io",
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  ioInstance = io;

  io.on("connection", (socket: Socket) => {
    console.log(`[ZaloQrBridge] Client kết nối: ${socket.id}`);

    // Khi người dùng bấm "Bắt đầu đăng nhập" hoặc modal tự động kích hoạt
    socket.on("start-login", async (data?: { targetAppUrl?: string; customParams?: any }) => {
      const { targetAppUrl, customParams } = data || {};

      try {
        socket.emit("status-update", {
          step: "init",
          message: "Đang kết nối Zalo Gateway & tạo mã QR...",
        });

        const zalo = new Zalo({
          selfListen: false,
          checkUpdate: false,
        });

        activeSessions.set(socket.id, { zalo, targetAppUrl, customParams });

        console.log(`[ZaloQrBridge] Bắt đầu tạo mã QR cho socket ${socket.id}...`);

        // Gọi loginQR của zca-js
        const api = await (zalo as any).loginQR({}, (qrEvent: any) => {
          try {
            // Trường hợp 1: zca-js trả về event object (v2.x)
            if (qrEvent && typeof qrEvent === "object" && qrEvent.type !== undefined) {
              switch (qrEvent.type) {
                case 0: { // LoginQRCallbackEventType.QRCodeGenerated
                  if (qrEvent.data && qrEvent.data.image) {
                    const base64Image = qrEvent.data.image.startsWith("data:image")
                      ? qrEvent.data.image
                      : `data:image/png;base64,${qrEvent.data.image}`;

                    socket.emit("qr-received", {
                      qrImage: base64Image,
                      message: "Vui lòng mở ứng dụng Zalo trên điện thoại và quét mã QR này.",
                    });
                    socket.emit("status-update", {
                      step: "waiting_scan",
                      message: "Mã QR đã sẵn sàng! Đang đợi bạn quét mã trên Zalo...",
                    });
                    console.log(`[ZaloQrBridge] Đã phát mã QR cho socket ${socket.id}`);
                  }
                  break;
                }

                case 1: { // LoginQRCallbackEventType.QRCodeExpired
                  socket.emit("status-update", {
                    step: "qr_expired",
                    message: "Mã QR đã hết hạn. Vui lòng bấm tạo mã mới để quét lại.",
                  });
                  console.log(`[ZaloQrBridge] Mã QR hết hạn cho socket ${socket.id}`);
                  break;
                }

                case 2: { // LoginQRCallbackEventType.QRCodeScanned
                  socket.emit("status-update", {
                    step: "scanned",
                    message: "Đã quét mã thành công! Vui lòng bấm Xác nhận đăng nhập trên điện thoại...",
                  });
                  console.log(`[ZaloQrBridge] Đã quét mã QR cho socket ${socket.id}, đang đợi xác nhận`);
                  break;
                }

                case 3: { // LoginQRCallbackEventType.QRCodeDeclined
                  socket.emit("login-error", {
                    message: "Bạn đã từ chối xác thực đăng nhập trên ứng dụng Zalo.",
                  });
                  console.log(`[ZaloQrBridge] Người dùng từ chối xác nhận cho socket ${socket.id}`);
                  break;
                }
              }
              return;
            }

            // Trường hợp 2: zca-js trả về file ảnh qrPath
            if (typeof qrEvent === "string" && fs.existsSync(qrEvent)) {
              const qrBuffer = fs.readFileSync(qrEvent);
              const qrBase64 = `data:image/png;base64,${qrBuffer.toString("base64")}`;

              socket.emit("qr-received", {
                qrImage: qrBase64,
                message: "Vui lòng mở ứng dụng Zalo trên điện thoại và quét mã QR này.",
              });
              socket.emit("status-update", {
                step: "waiting_scan",
                message: "Đang đợi quét mã và xác nhận trên app...",
              });

              fs.unlink(qrEvent, () => {});
              return;
            }
          } catch (readErr) {
            console.error("[ZaloQrBridge] Lỗi khi xử lý dữ liệu QR:", readErr);
          }
        });

        // Khi Promise resolve: Đăng nhập Zalo thành công!
        socket.emit("status-update", {
          step: "logged_in",
          message: "Đăng nhập Zalo thành công! Đang thiết lập phiên làm việc...",
        });

        const context = api.getContext();
        const ownId = typeof api.getOwnId === "function" ? api.getOwnId() : context.uid;

        console.log(`[ZaloQrBridge] Đăng nhập Zalo thành công cho UID: ${ownId}`);

        const sessionPayload: ZaloAuthPayload = {
          event: "ZALO_AUTH_SUCCESS",
          timestamp: new Date().toISOString(),
          userId: ownId,
          context: {
            uid: context.uid,
            imei: context.imei,
            cookie: context.cookie,
            userAgent: context.userAgent,
            secretKey: context.secretKey || null,
            sessionKey: context.sessionKey || null,
          },
          customParams: customParams || {},
        };

        // 1. Tự động lưu session và tạo Founder JWT Token trực tiếp vào hệ thống
        const authResult = await handleZaloWebhook(sessionPayload);

        // 2. Kích hoạt Inbound Listener để AI Agent sẵn sàng tiếp nhận lệnh 2 chiều
        startZaloInboundListener().catch((inboundErr) => {
          console.warn("[ZaloQrBridge] Không thể khởi động ZaloInboundListener:", inboundErr);
        });

        // 3. Nếu có targetAppUrl bên ngoài, gửi webhook bổ sung
        if (targetAppUrl && (targetAppUrl.startsWith("http://") || targetAppUrl.startsWith("https://"))) {
          try {
            const dispatchResponse = await fetch(targetAppUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Source": "Zalo-Auth-Bridge",
              },
              body: JSON.stringify(sessionPayload),
              signal: AbortSignal.timeout(10000),
            });
            console.log(`[ZaloQrBridge] Gửi webhook sang ${targetAppUrl} thành công (${dispatchResponse.status})`);
          } catch (whErr: any) {
            console.warn(`[ZaloQrBridge] Gửi webhook sang ${targetAppUrl} thất bại:`, whErr.message);
          }
        }

        // 4. Phát thông báo hoàn tất về client qua Socket
        socket.emit("login-complete", {
          success: true,
          message: "Xác thực Zalo thành công và phiên làm việc đã sẵn sàng!",
          token: authResult.activeSession.token,
          founder: authResult.activeSession.founder,
          userId: ownId,
          sessionInfo: {
            uid: sessionPayload.userId,
            imei: sessionPayload.context.imei,
          },
          sessionData: sessionPayload,
        });
      } catch (error: any) {
        console.error("[ZaloQrBridge] Lỗi phiên đăng nhập Zalo:", error);
        socket.emit("login-error", {
          message: error.message || "Đăng nhập thất bại hoặc phiên tạo mã QR gặp lỗi.",
        });
      } finally {
        activeSessions.delete(socket.id);
      }
    });

    socket.on("disconnect", () => {
      activeSessions.delete(socket.id);
      console.log(`[ZaloQrBridge] Client đã ngắt: ${socket.id}`);
    });
  });

  console.log("[ZaloQrBridge] Socket.io QR Auth Gateway đã khởi tạo sẵn sàng tại /socket.io");
  return io;
}
