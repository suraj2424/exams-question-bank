import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans, Noto_Sans_Devanagari } from "next/font/google";
import { CatalogProvider } from "@/components/catalog-provider";
import { LangProvider } from "@/components/lang-provider";
import "./globals.css";

const display = Archivo({
  subsets: ["latin"],
  variable: "--qb-font-display",
  display: "swap",
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--qb-font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--qb-font-mono",
  display: "swap",
});

const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari", "latin"],
  variable: "--qb-font-devanagari",
  display: "swap",
});

export const metadata: Metadata = {
  title: "IBPS PO Bilingual Practice",
  description: "Bilingual English/Hindi practice for the IBPS PO exam, with a marked answer sheet for every session.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} ${devanagari.variable} h-app w-app overflow-hidden`}
    >
      <body className="h-app max-h-app w-app max-w-app overflow-hidden antialiased">
        <LangProvider>
          <CatalogProvider>{children}</CatalogProvider>
        </LangProvider>
      </body>
    </html>
  );
}
