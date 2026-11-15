import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(frontendRoot, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
const destination = resolve(frontendRoot, "public/maplibre-gl-worker.mjs");

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log("MapLibre worker copied to public/maplibre-gl-worker.mjs");
