import type { Metadata } from "next";
import "./globals.css";
import "./screens.css";
import "./archive.css";
import "./gallery.css";
import "./responsive.css";
import "./redesign.css";
import "./landing.css";
import { BreatheProvider } from "@/context/BreatheContext";
import { ScientificSessionProvider } from "@/context/ScientificSessionContext";
import { SiteHeader } from "@/components/breathe/SharedUI";

export const metadata: Metadata = {
  title: "BREATHE — Earth Air Quality Sonification",
  description:
    "Explore atmospheric data from NASA Earth Observations and translate air quality into sound.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <BreatheProvider>
          <ScientificSessionProvider>
          <SiteHeader />
          <main>{children}</main>
          </ScientificSessionProvider>
        </BreatheProvider>
      </body>
    </html>
  );
}
