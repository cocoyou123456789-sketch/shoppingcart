import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);

  return {
    metadataBase: base,
    title: "松松逛｜虚拟购物与数字衣橱",
    description: "不用真钱也能轻松逛；创建可调节的三维分身，录入自己的衣服，试穿并生成每日搭配。",
    icons: {
      icon: "/favicon.png",
      shortcut: "/favicon.png",
    },
    openGraph: {
      title: "松松逛｜喜欢就先在这里拥有",
      description: "0 元虚拟购物、可调三维分身、数字衣橱与每日搭配。",
      type: "website",
      url: base,
      locale: "zh_CN",
      images: [{ url: new URL("/og.png", base), width: 1200, height: 630, alt: "松松逛虚拟购物与数字衣橱" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "松松逛｜喜欢就先在这里拥有",
      description: "0 元虚拟购物、可调三维分身、数字衣橱与每日搭配。",
      images: [new URL("/og.png", base)],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={geist.variable}>{children}</body>
    </html>
  );
}
