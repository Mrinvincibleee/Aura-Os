import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aura OS — AI video clipping studio",
  description: "Turn long videos into polished short-form clips with AI.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
