import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";
import { NotificationToast } from "@/components/notifications";
import { AuthProvider } from "@/lib/auth";
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
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
            <NotificationToast />
          </NotificationsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
