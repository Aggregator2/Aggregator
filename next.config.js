/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: process.cwd(),
  // Disable strict mode for production builds
  reactStrictMode: false,
  // Ensure all pages are statically generated when possible
  trailingSlash: false,
  // Configure domains for images if needed
  images: {
    unoptimized: true
  }
}

module.exports = nextConfig
