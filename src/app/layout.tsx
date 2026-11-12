import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { AssistantWidget } from "@/components/assistant/assistant-widget";
import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";
import { NotificationToast } from "@/components/notifications";
import { AuthProvider } from "@/lib/auth";
import { CallProvider, CallSlot } from "@/lib/call";
import { LeaveGuardProvider } from "@/lib/leave-guard";
import { NotificationsProvider } from "@/lib/notifications";

import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "MedConnect — Book doctors and consult online", template: "%s · MedConnect" },
  description: "Find doctors, book appointments and consult them by video.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <AuthProvider>
          <NotificationsProvider>
            <LeaveGuardProvider>
              <CallProvider>
                <Navbar />
                <main className="flex-1">
                  {children}
                  {/* The video call lives here, above the pages, so moving around doesn't hang up. */}
                  <CallSlot />
                </main>
                <Footer />
                <NotificationToast />
                {/* Patients' AI assistant: a chat button on every page (not on the call page). */}
                <AssistantWidget />
              </CallProvider>
            </LeaveGuardProvider>
          </NotificationsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
