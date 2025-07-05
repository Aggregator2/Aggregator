/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  // Disable SWC minification to avoid issues
  swcMinify: false,
  // Output standalone for Vercel
  output: 'standalone',
}

module.exports = nextConfig