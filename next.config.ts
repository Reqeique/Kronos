import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "http://192.168.1.12:3000",
    "http://192.168.1.12",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ],
};

export default nextConfig;
