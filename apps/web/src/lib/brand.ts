/**
 * The company and product named on screens. Each client install sets its own values with the
 * NEXT_PUBLIC_BRAND_* environment variables (set before `npm run build:web`); the defaults are the sample company.
 */
export const BRAND = {
  /** The client's company name: sidebar, login page. */
  name: process.env.NEXT_PUBLIC_BRAND_NAME || 'DEMO LTD',
  /** Short name used in the browser tab: "DEMO ERP". */
  short: process.env.NEXT_PUBLIC_BRAND_SHORT || 'DEMO',
  /** The company line under the login page and on printed reports. */
  footer: process.env.NEXT_PUBLIC_BRAND_FOOTER || 'DEMO LTD',
  /** The address on the login page and on printed reports. */
  address: process.env.NEXT_PUBLIC_BRAND_ADDRESS || 'Plot No. 25, Demo Industrial Estate, Main Road, Rajkot, Gujarat 360001, India',
  /** The software's own name, shown under the company name. */
  product: process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Manufacturing ERP',
};
