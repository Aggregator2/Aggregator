import { Request, Response, NextFunction } from 'express';
import { BadRequestError } from './errorHandler';

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
  links?: {
    self: string;
    first: string;
    last: string;
    next?: string;
    prev?: string;
  };
}

// Extend Express Request to include pagination
declare global {
  namespace Express {
    interface Request {
      pagination?: PaginationParams;
    }
  }
}

// Default pagination settings
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Pagination middleware
export const paginationMiddleware = (
  defaultLimit: number = DEFAULT_LIMIT,
  maxLimit: number = MAX_LIMIT
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Parse page number
      const page = parseInt(req.query.page as string) || DEFAULT_PAGE;
      if (page < 1) {
        throw new BadRequestError('Page number must be greater than 0');
      }

      // Parse limit
      let limit = parseInt(req.query.limit as string) || defaultLimit;
      if (limit < 1) {
        throw new BadRequestError('Limit must be greater than 0');
      }
      if (limit > maxLimit) {
        limit = maxLimit;
      }

      // Calculate offset
      const offset = (page - 1) * limit;

      // Parse sort parameters
      const sort = req.query.sort as string;
      const order = (req.query.order as string || 'asc').toLowerCase() as 'asc' | 'desc';
      
      if (order !== 'asc' && order !== 'desc') {
        throw new BadRequestError('Order must be either "asc" or "desc"');
      }

      // Attach pagination params to request
      req.pagination = {
        page,
        limit,
        offset,
        sort,
        order
      };

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Helper function to create paginated response
export const createPaginatedResponse = <T>(
  data: T[],
  total: number,
  pagination: PaginationParams,
  baseUrl: string
): PaginatedResponse<T> => {
  const { page, limit } = pagination;
  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;

  // Build query string without page parameter
  const buildQueryString = (pageNum: number): string => {
    const params = new URLSearchParams();
    params.set('page', pageNum.toString());
    params.set('limit', limit.toString());
    if (pagination.sort) params.set('sort', pagination.sort);
    if (pagination.order) params.set('order', pagination.order);
    return params.toString();
  };

  const response: PaginatedResponse<T> = {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage,
      hasPreviousPage
    },
    links: {
      self: `${baseUrl}?${buildQueryString(page)}`,
      first: `${baseUrl}?${buildQueryString(1)}`,
      last: `${baseUrl}?${buildQueryString(totalPages)}`
    }
  };

  if (hasNextPage && response.links) {
    response.links.next = `${baseUrl}?${buildQueryString(page + 1)}`;
  }

  if (hasPreviousPage && response.links) {
    response.links.prev = `${baseUrl}?${buildQueryString(page - 1)}`;
  }

  return response;
};

// Utility function to apply pagination to database queries
export const applyPagination = <T>(
  query: any,
  pagination: PaginationParams
): any => {
  // This is a generic implementation that can be adapted for different ORMs
  // For example, with Prisma:
  return {
    ...query,
    skip: pagination.offset,
    take: pagination.limit,
    ...(pagination.sort && {
      orderBy: {
        [pagination.sort]: pagination.order
      }
    })
  };
};

// Response helper for sending paginated responses
export const sendPaginatedResponse = <T>(
  res: Response,
  data: T[],
  total: number,
  pagination: PaginationParams,
  statusCode: number = 200
): void => {
  const baseUrl = `${res.req.protocol}://${res.req.get('host')}${res.req.baseUrl}${res.req.path}`;
  const paginatedResponse = createPaginatedResponse(data, total, pagination, baseUrl);
  
  res.status(statusCode).json(paginatedResponse);
};