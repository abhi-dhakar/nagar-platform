import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NagarDeploy — Nagar",
  description: "A clear path from source code to live, dependable applications.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
