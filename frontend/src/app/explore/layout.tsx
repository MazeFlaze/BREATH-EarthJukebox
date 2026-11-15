import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Explore Earth's Air — BREATHE",
  description:
    "Interactive 3D globe and 2D flat cartography powered by NASA GEOS-CF v2 atmospheric observations.",
};

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
