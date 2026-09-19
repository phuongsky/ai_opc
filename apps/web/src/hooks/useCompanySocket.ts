"use client";

import { useEffect, useRef, useState } from "react";
import type { CompanyEvent } from "@ai-opc/shared";
import { WS_URL } from "@/lib/api";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10000;

export function useCompanySocket() {
  const [lastEvent, setLastEvent] = useState<CompanyEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        attemptRef.current = 0;
        setIsConnected(true);
      };

      socket.onmessage = (event) => {
        try {
          setLastEvent(JSON.parse(event.data) as CompanyEvent);
        } catch {
          // ignore malformed frame
        }
      };

      // Cả onclose lẫn onerror đều có thể bắn ra khi mất kết nối — chỉ lên
      // lịch reconnect ở onclose để tránh lên lịch 2 lần cho cùng 1 sự cố.
      socket.onclose = () => {
        setIsConnected(false);
        if (cancelled) return;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attemptRef.current, RECONNECT_MAX_MS);
        attemptRef.current += 1;
        timerRef.current = setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket?.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      socket?.close();
    };
  }, []);

  return { lastEvent, isConnected };
}
