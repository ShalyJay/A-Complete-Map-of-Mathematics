import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "A Complete Map of Math, Physics & CS",
  description:
    "An explorable, zoomable knowledge graph of mathematics, physics and computer science, from domains and subject maps down to individual concepts and theorems, generated from a curated Obsidian research vault (MSC 2020 for mathematics).",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>{children}</body>
    </html>
  );
}
