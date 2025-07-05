import { CursorData } from '../types/orderHistory';

export class CursorPagination {
  /**
   * Encode cursor data to base64 string
   */
  static encodeCursor(data: CursorData): string {
    const json = JSON.stringify({
      t: data.timestamp.toISOString(),
      id: data.orderId,
      v: data.sortValue
    });
    return Buffer.from(json).toString('base64url');
  }

  /**
   * Decode cursor string to cursor data
   */
  static decodeCursor(cursor: string): CursorData | null {
    try {
      const json = Buffer.from(cursor, 'base64url').toString('utf-8');
      const data = JSON.parse(json);
      
      return {
        timestamp: new Date(data.t),
        orderId: data.id,
        sortValue: data.v
      };
    } catch (error) {
      console.error('Invalid cursor:', error);
      return null;
    }
  }

  /**
   * Build cursor condition for database query
   */
  static buildCursorCondition(
    cursor: CursorData | null,
    sortBy: string,
    sortOrder: 'asc' | 'desc'
  ): any {
    if (!cursor) return {};

    const operator = sortOrder === 'desc' ? 'lt' : 'gt';
    const orOperator = sortOrder === 'desc' ? 'lte' : 'gte';

    // Handle different sort fields
    switch (sortBy) {
      case 'timestamp':
        return {
          OR: [
            { createdAt: { [operator]: cursor.timestamp } },
            {
              AND: [
                { createdAt: cursor.timestamp },
                { id: { [operator]: cursor.orderId } }
              ]
            }
          ]
        };

      case 'pnl':
      case 'volume':
      case 'filledQuantity':
        // For numeric fields, we need to handle ties
        return {
          OR: [
            { [sortBy]: { [operator]: cursor.sortValue } },
            {
              AND: [
                { [sortBy]: cursor.sortValue },
                { createdAt: { [operator]: cursor.timestamp } }
              ]
            },
            {
              AND: [
                { [sortBy]: cursor.sortValue },
                { createdAt: cursor.timestamp },
                { id: { [operator]: cursor.orderId } }
              ]
            }
          ]
        };

      default:
        // Fallback to timestamp-based cursor
        return {
          OR: [
            { createdAt: { [operator]: cursor.timestamp } },
            {
              AND: [
                { createdAt: cursor.timestamp },
                { id: { [operator]: cursor.orderId } }
              ]
            }
          ]
        };
    }
  }

  /**
   * Generate next cursor from the last item in results
   */
  static generateNextCursor(
    lastItem: any,
    sortBy: string
  ): string | undefined {
    if (!lastItem) return undefined;

    let sortValue: any;
    switch (sortBy) {
      case 'pnl':
        sortValue = lastItem.realizedPnL || '0';
        break;
      case 'volume':
        sortValue = lastItem.totalVolume || '0';
        break;
      case 'filledQuantity':
        sortValue = lastItem.filledQuantity || '0';
        break;
      case 'price':
        sortValue = lastItem.price || '0';
        break;
      default:
        sortValue = undefined;
    }

    const cursorData: CursorData = {
      timestamp: lastItem.createdAt,
      orderId: lastItem.id,
      sortValue
    };

    return this.encodeCursor(cursorData);
  }

  /**
   * Generate previous cursor for backward pagination
   */
  static generatePreviousCursor(
    firstItem: any,
    sortBy: string
  ): string | undefined {
    if (!firstItem) return undefined;

    // Similar to generateNextCursor but for the first item
    return this.generateNextCursor(firstItem, sortBy);
  }

  /**
   * Validate cursor format
   */
  static isValidCursor(cursor: string): boolean {
    try {
      const decoded = this.decodeCursor(cursor);
      return decoded !== null && 
             decoded.timestamp instanceof Date && 
             typeof decoded.orderId === 'string';
    } catch {
      return false;
    }
  }
}