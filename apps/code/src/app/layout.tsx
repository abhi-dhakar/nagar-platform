import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NagarCode — Nagar",
  description: "A thoughtful workspace for writing, shaping, and shipping software.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
