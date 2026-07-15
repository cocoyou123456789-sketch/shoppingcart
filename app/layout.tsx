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
    title: "松松逛｜真实好物、虚拟购物与数字衣橱",
    description: "连接真实服装网站，也保留 0 元虚拟购物；把商品链接带回数字衣橱，试穿并生成每日搭配。",
    icons: {
      icon: "/favicon-48.png",
      shortcut: "/favicon-48.png",
      apple: "/favicon.png",
    },
    openGraph: {
      title: "松松逛｜喜欢就先在这里拥有",
      description: "真实服装网站入口、0 元虚拟购物、可调三维分身、数字衣橱与每日搭配。",
      type: "website",
      url: base,
      locale: "zh_CN",
      images: [{ url: new URL("/og-real-v1.jpg", base), width: 1200, height: 630, alt: "松松逛真人风格虚拟试穿与数字衣橱" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "松松逛｜喜欢就先在这里拥有",
      description: "真实服装网站入口、0 元虚拟购物、可调三维分身、数字衣橱与每日搭配。",
      images: [new URL("/og-real-v1.jpg", base)],
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
