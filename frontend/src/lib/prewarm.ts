import { loadWorldBoundariesQuick } from "./worldBoundaries";
import { prefetchOverlayFrame } from "./geosCfRaster";
import { timeSlots } from "./breatheData";

let prewarmed = false;

interface NetworkInformation extends EventTarget {
  saveData?: boolean;
  effectiveType?: string;
}

export async function prewarmCoreAssets() {
  if (prewarmed) return;
  prewarmed = true;

  try {
    // 1. Kiểm tra tiết kiệm dữ liệu di động
    const conn = (navigator as unknown as { connection?: NetworkInformation }).connection;
    const isSaveData = conn?.saveData === true;
    const isSlowConnection = /2g|3g/.test(conn?.effectiveType || "");

    // 2. Nạp sẵn bản đồ ranh giới quốc gia vào RAM (nhẹ ~80KB)
    await loadWorldBoundariesQuick();

    // 3. Nếu không phải chế độ tiết kiệm dữ liệu, nạp khung ô nhiễm không khí gần nhất
    if (!isSaveData && !isSlowConnection && timeSlots.length > 0) {
      const latestIndex = timeSlots.length - 1;
      prefetchOverlayFrame("PM25_RH35", latestIndex);
      prefetchOverlayFrame("NO2", latestIndex);
    }
  } catch (err) {
    console.debug("[BREATHE] Prewarm background notice:", err);
  }
}
