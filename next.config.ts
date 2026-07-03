import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    allowedDevOrigins: [
        "http://192.168.1.12:3737",
        "http://192.168.1.12",
        "http://localhost:3737",
        "http://127.0.0.1:3737",
        "http://localhost:7766",
        "http://127.0.0.1:7766",
        "http://localhost:8789",
        "http://127.0.0.1:8789",
    ],
};

export default nextConfig;
