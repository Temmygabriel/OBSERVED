/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // @observed/shared-types ships TypeScript source rather than a built bundle.
  // Next compiles it as part of this app, which means there is no separate
  // build step and no window where the frontend and the worker disagree about
  // what a field is called.
  transpilePackages: ['@observed/shared-types'],
};

export default nextConfig;
