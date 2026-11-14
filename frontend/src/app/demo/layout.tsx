import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BREATHE Listening Lab | Notebook Demo A",
  description: "Khám phá sáu chất trong GEOS-CF qua bản đồ vùng, xung dữ liệu và hòa âm có thể đối chiếu với notebook.",
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
