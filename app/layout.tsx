import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Post Studio",
  description: "Generate and publish product posts to Instagram, Facebook and Pinterest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
