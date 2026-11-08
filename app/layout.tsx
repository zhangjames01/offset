import type { Metadata } from "next";
// Self-hosted Geist (no Google Fonts fetch at build time).
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { CartProvider } from "@/components/CartProvider";
import { NavBar } from "@/components/NavBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Offset",
  description: "Purchase-linked giving at checkout.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NavBar />
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
