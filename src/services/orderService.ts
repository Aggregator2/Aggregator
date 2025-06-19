import { PrismaClient, OrderStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

export interface PlaceOrderInput {
  userId: string;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
  paymentMethod?: string;
  shippingAddress?: any;
  billingAddress?: any;
  notes?: string;
}

export interface UpdateOrderStatusInput {
  orderId: string;
  status: OrderStatus;
  comment?: string;
  changedBy?: string;
  txHash?: string;
  escrowAddress?: string;
}

export class OrderService {
  async placeOrder(input: PlaceOrderInput) {
    return await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: {
          id: { in: input.items.map(item => item.productId) },
          isActive: true
        }
      });

      if (products.length !== input.items.length) {
        throw new Error('One or more products not found or inactive');
      }

      const productMap = new Map(products.map(p => [p.id, p]));
      
      for (const item of input.items) {
        const product = productMap.get(item.productId)!;
        if (product.stock < item.quantity) {
          throw new Error(`Insufficient stock for product ${product.name}`);
        }
      }

      let totalAmount = new Decimal(0);
      const lineItems: Prisma.LineItemCreateManyOrderInput[] = [];

      for (const item of input.items) {
        const product = productMap.get(item.productId)!;
        const lineTotal = product.price.mul(item.quantity);
        
        lineItems.push({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: product.price,
          totalPrice: lineTotal
        });

        totalAmount = totalAmount.add(lineTotal);

        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } }
        });
      }

      const order = await tx.order.create({
        data: {
          userId: input.userId,
          totalAmount,
          paymentMethod: input.paymentMethod,
          shippingAddress: input.shippingAddress,
          billingAddress: input.billingAddress,
          notes: input.notes,
          lineItems: {
            createMany: {
              data: lineItems
            }
          },
          statusHistory: {
            create: {
              status: OrderStatus.PENDING,
              comment: 'Order placed',
              changedBy: input.userId
            }
          }
        },
        include: {
          lineItems: {
            include: {
              product: true
            }
          },
          user: {
            select: {
              id: true,
              email: true,
              walletAddress: true
            }
          }
        }
      });

      return order;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });
  }

  async updateOrderStatus(input: UpdateOrderStatusInput) {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        include: {
          lineItems: {
            include: {
              product: true
            }
          }
        }
      });

      if (!order) {
        throw new Error('Order not found');
      }

      this.validateStatusTransition(order.status, input.status);

      const updatedOrder = await tx.order.update({
        where: { id: input.orderId },
        data: {
          status: input.status,
          txHash: input.txHash || order.txHash,
          escrowAddress: input.escrowAddress || order.escrowAddress,
          statusHistory: {
            create: {
              status: input.status,
              comment: input.comment,
              changedBy: input.changedBy
            }
          }
        },
        include: {
          lineItems: {
            include: {
              product: true
            }
          },
          statusHistory: {
            orderBy: { createdAt: 'desc' },
            take: 5
          },
          user: {
            select: {
              id: true,
              email: true,
              walletAddress: true
            }
          }
        }
      });

      if (input.status === OrderStatus.CANCELLED) {
        for (const lineItem of order.lineItems) {
          await tx.product.update({
            where: { id: lineItem.productId },
            data: { stock: { increment: lineItem.quantity } }
          });
        }
      }

      return updatedOrder;
    });
  }

  private validateStatusTransition(currentStatus: OrderStatus, newStatus: OrderStatus) {
    const validTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
      [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
      [OrderStatus.PROCESSING]: [OrderStatus.ESCROW_DEPOSITED, OrderStatus.CANCELLED],
      [OrderStatus.ESCROW_DEPOSITED]: [OrderStatus.ESCROW_RELEASED, OrderStatus.REFUNDED],
      [OrderStatus.ESCROW_RELEASED]: [OrderStatus.SHIPPED],
      [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
      [OrderStatus.DELIVERED]: [OrderStatus.COMPLETED],
      [OrderStatus.COMPLETED]: [],
      [OrderStatus.CANCELLED]: [],
      [OrderStatus.REFUNDED]: []
    };

    if (!validTransitions[currentStatus].includes(newStatus)) {
      throw new Error(`Invalid status transition from ${currentStatus} to ${newStatus}`);
    }
  }

  async getOrder(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        lineItems: {
          include: {
            product: true
          }
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' }
        },
        user: {
          select: {
            id: true,
            email: true,
            walletAddress: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    if (!order) {
      throw new Error('Order not found');
    }

    return order;
  }

  async getUserOrders(userId: string, page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where: { userId },
        include: {
          lineItems: {
            include: {
              product: true
            }
          },
          statusHistory: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.order.count({ where: { userId } })
    ]);

    return {
      orders,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }
}

export const orderService = new OrderService();