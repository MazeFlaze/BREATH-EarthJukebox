
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "earthobservatory.nasa.gov",
      },
      {
        protocol: "https",
        hostname: "worldview.earthdata.nasa.gov",
      },
      {
        protocol: "https",
        hostname: "gibs.earthdata.nasa.gov",
      },
      {
        protocol: "https",
        hostname: "wvs.earthdata.nasa.gov",
      },
      {
        protocol: "https",
        hostname: "svs.gsfc.nasa.gov",
      },
    ],
  },
};

export default nextConfig;
