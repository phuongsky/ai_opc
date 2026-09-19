import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/context/I18nContext";

export const metadata: Metadata = {
  title: "AI-OPC Company OS",
  description: "Executive Cockpit — one-person company operating system powered by AI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased" suppressHydrationWarning>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
