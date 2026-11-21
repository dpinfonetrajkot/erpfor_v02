/**
 * The company named on PDFs when no company is set up yet, and by the assistant.
 * Each client install sets its own BRAND_NAME / BRAND_SHORT; the defaults are the sample company.
 */
export const brand = () => ({
  name: process.env.BRAND_NAME || 'DEMO LTD',
  short: process.env.BRAND_SHORT || 'DEMO',
});
