import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ArtCraft S3 Hub — Next.js Admin & MinIO Console",
  description: "Distribution mirror, MinIO S3 object storage, and package management for ArtCraft Launcher",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={`${geistSans.variable} ${geistMono.variable} dark h-full`}>
      <body className="min-h-full bg-[#0a0b0e] text-[#ededed] font-sans antialiased flex flex-col">
        {children}
      </body>
    </html>
  );
}
