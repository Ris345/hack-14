import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "hack-14",
  description: "Find the people worth meeting at a Luma event.",
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
