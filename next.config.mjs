/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    // Cross-origin isolation => ONNX Runtime duoc phep dung WebAssembly da luong (nhanh hon 2-4x).
    // 'credentialless' van cho phep nap video/stream tu domain khac (CORS).
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
      {
        // Cache model + wasm lau dai (file lon, khong doi)
        source: "/(models|ort)/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
