import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

// Senior DS: Public Sans é a única família tipográfica do produto.
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Scout 360 — Enriquecimento de contas",
  description:
    "Transforme CNPJ, domínio, e-mail ou nome em contas identificadas e prontas para análise. Envie as pistas disponíveis — não precisa ter CNPJ.",
  keywords: ["Scout 360", "Senior", "enriquecimento de contas", "CNPJ", "matriz", "prospecção"],
  icons: {
    icon: "/senior-simbolo-box-verde.png",
    apple: "/senior-simbolo-box-verde.png",
  },
  // Gate 1 (missão v0.11.0): ambiente interno de inteligência comercial —
  // nenhuma rota deve ser indexada, seguida ou arquivada por buscadores.
  // Reforço duplo: todo HTTP carrega X-Robots-Tag (next.config.ts) e o
  // robots.txt nega rastreamento. Este meta cobre o HTML renderizado.
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="light">
      <body className={`${publicSans.variable} antialiased bg-background text-foreground`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
