import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NagarCode — Nagar Platform",
  description:
    "A thoughtful workspace for writing, shaping, and shipping software. Browser-based editor with workspace abstraction, Monaco, and Nagar identity.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
