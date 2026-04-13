/** @type {import('next').NextConfig} */
const backendOrigin = process.env.OPENSTOKO_BACKEND_ORIGIN || 'http://backend:8000';

const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendOrigin}/api/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${backendOrigin}/uploads/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
