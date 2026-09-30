import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NagarHub — Nagar",
  description: "A home for repositories, collaboration, and the ideas that move software forward.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
