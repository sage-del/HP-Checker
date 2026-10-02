import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // dev サーバーに 127.0.0.1 / ::1 で入っても /_next/hmr が cross-origin 扱いで
  // ブロックされないようにする（E2E スモークは 127.0.0.1 でも動く必要がある）。
  allowedDevOrigins: ["127.0.0.1", "[::1]"],
};

export default nextConfig;
