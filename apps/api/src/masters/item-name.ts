import type { EndConnection } from '../generated/prisma/client';

/** "2\" FIG 100" + "MALE" + "BW" -> "2\" FIG 100 MALE BW" (the name staff already use). */
export function itemName(productName: string, partTypeName: string, endConnection: EndConnection): string {
  return [productName, partTypeName, endConnection === 'NONE' ? null : endConnection]
    .filter(Boolean)
    .join(' ');
}
