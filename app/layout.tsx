import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "hack-14",
  description: "Google sign-in",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
