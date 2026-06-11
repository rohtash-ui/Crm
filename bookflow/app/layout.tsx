import type { Metadata } from "next";
import { Geist } from "next/font/google";
import SessionProvider from "@/components/SessionProvider";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "BookFlow - Smart Scheduling Made Simple",
  description: "Calendly-style booking with PayPal payments. Let clients book and pay in one seamless flow.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="min-h-full bg-gray-50 text-gray-900 antialiased font-sans">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
