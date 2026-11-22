/** @type {import('next').NextConfig} */
const nextConfig = {
  // Old staff pages now live as tabs in the /admin hub.
  async redirects() {
    return [
      { source: '/admin/claims', destination: '/admin?tab=claims', permanent: false },
      { source: '/admin/alts', destination: '/admin?tab=members&sub=alts', permanent: false },
      { source: '/admin/raid-reminders', destination: '/admin?tab=discord&sub=raids', permanent: false },
      { source: '/admin/bumps', destination: '/admin?tab=discord&sub=bumps', permanent: false },
      { source: '/assault/admin', destination: '/admin?tab=assault', permanent: false },
      { source: '/discord-mapping', destination: '/admin?tab=discord&sub=mapping', permanent: false },
      { source: '/data-management', destination: '/admin?tab=system&sub=data', permanent: false },
      { source: '/price-cache', destination: '/admin?tab=system&sub=prices', permanent: false },
    ];
  },
}
module.exports = nextConfig
