import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodeMind — AI Codebase Chat",
  description: "Chat with your entire codebase using local AI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="h-screen overflow-hidden">{children}</body>
    </html>
  );
}
