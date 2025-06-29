import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { PrismaClient } from '@prisma/client';
import { AuctionManager } from '../rfq/AuctionManager';
import { logger } from '../../../utils/logger';
import jwt from 'jsonwebtoken';

export class AuctionWebSocketServer {
  private io: SocketIOServer;
  private prisma: PrismaClient;
  private auctionManager: AuctionManager;
  private auctionRooms: Map<string, Set<string>> = new Map();

  constructor(httpServer: HTTPServer) {
    this.prisma = new PrismaClient();
    this.auctionManager = new AuctionManager(this.prisma);
    
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
        credentials: true,
      },
    });

    this.setupEventHandlers();
    this.setupSocketHandlers();
  }

  private setupEventHandlers(): void {
    // Listen to auction events
    this.auctionManager.on('auction:started', ({ auction, quotes }) => {
      const room = `auction:${auction.id}`;
      this.io.to(room).emit('auction:started', {
        auctionId: auction.id,
        rfqId: auction.rfqId,
        startTime: auction.startTime,
        endTime: auction.endTime,
        initialQuotes: quotes.map(q => ({
          id: q.id,
          marketMakerId: q.marketMakerId,
          price: q.price.toString(),
          size: q.size.toString(),
        })),
      });
    });

    this.auctionManager.on('auction:improved_quote', ({ auction, newQuote, improvement }) => {
      const room = `auction:${auction.id}`;
      this.io.to(room).emit('auction:improved_quote', {
        auctionId: auction.id,
        quote: {
          id: newQuote.id,
          marketMakerId: newQuote.marketMakerId,
          price: newQuote.price.toString(),
          size: newQuote.size.toString(),
          improvementBps: improvement,
        },
        timestamp: new Date(),
      });
    });

    this.auctionManager.on('auction:ended', ({ auction, winningQuote }) => {
      const room = `auction:${auction.id}`;
      this.io.to(room).emit('auction:ended', {
        auctionId: auction.id,
        winningQuote: winningQuote ? {
          id: winningQuote.id,
          marketMakerId: winningQuote.marketMakerId,
          price: winningQuote.price.toString(),
          size: winningQuote.size.toString(),
        } : null,
        executedPrice: auction.executedPrice?.toString(),
        executedSize: auction.executedSize?.toString(),
      });

      // Clean up room
      this.auctionRooms.delete(auction.id);
    });
  }

  private setupSocketHandlers(): void {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication required'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
        socket.data.userId = decoded.userId;
        socket.data.role = decoded.role;
        
        // For market makers
        if (socket.handshake.auth.marketMakerId) {
          const marketMaker = await this.prisma.marketMaker.findUnique({
            where: { id: socket.handshake.auth.marketMakerId },
          });

          if (!marketMaker || !marketMaker.isActive) {
            return next(new Error('Invalid market maker'));
          }

          socket.data.marketMakerId = marketMaker.id;
        }

        next();
      } catch (error) {
        next(new Error('Authentication failed'));
      }
    });

    this.io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id}`);

      socket.on('subscribe:auction', async (auctionId: string) => {
        try {
          // Verify auction exists and user has access
          const auction = await this.prisma.auction.findUnique({
            where: { id: auctionId },
            include: {
              rfq: true,
            },
          });

          if (!auction) {
            socket.emit('error', { message: 'Auction not found' });
            return;
          }

          // Check access - either the RFQ creator or a participating market maker
          const hasAccess = auction.rfq.userId === socket.data.userId ||
            (socket.data.marketMakerId && await this.isMarketMakerParticipating(
              auctionId, 
              socket.data.marketMakerId
            ));

          if (!hasAccess) {
            socket.emit('error', { message: 'Access denied' });
            return;
          }

          // Join auction room
          const room = `auction:${auctionId}`;
          socket.join(room);

          // Track room membership
          if (!this.auctionRooms.has(auctionId)) {
            this.auctionRooms.set(auctionId, new Set());
          }
          this.auctionRooms.get(auctionId)!.add(socket.id);

          // Send current auction status
          const status = await this.auctionManager.getAuctionStatus(auctionId);
          if (status) {
            socket.emit('auction:status', {
              auction: status.auction,
              quotes: status.quotes.map(q => ({
                id: q.id,
                marketMakerId: q.marketMakerId,
                price: q.price.toString(),
                size: q.size.toString(),
                status: q.status,
              })),
              timeRemaining: status.timeRemaining,
              currentBest: status.currentBest ? {
                id: status.currentBest.id,
                price: status.currentBest.price.toString(),
                size: status.currentBest.size.toString(),
              } : null,
            });
          }
        } catch (error) {
          logger.error('Error subscribing to auction:', error);
          socket.emit('error', { message: 'Failed to subscribe to auction' });
        }
      });

      socket.on('unsubscribe:auction', (auctionId: string) => {
        const room = `auction:${auctionId}`;
        socket.leave(room);

        // Remove from tracking
        const roomMembers = this.auctionRooms.get(auctionId);
        if (roomMembers) {
          roomMembers.delete(socket.id);
          if (roomMembers.size === 0) {
            this.auctionRooms.delete(auctionId);
          }
        }
      });

      socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
        
        // Clean up room memberships
        this.auctionRooms.forEach((members, auctionId) => {
          if (members.has(socket.id)) {
            members.delete(socket.id);
            if (members.size === 0) {
              this.auctionRooms.delete(auctionId);
            }
          }
        });
      });
    });
  }

  private async isMarketMakerParticipating(
    auctionId: string, 
    marketMakerId: string
  ): Promise<boolean> {
    const quote = await this.prisma.quote.findFirst({
      where: {
        rfq: {
          auction: {
            id: auctionId,
          },
        },
        marketMakerId,
      },
    });

    return quote !== null;
  }

  public getActiveAuctions(): string[] {
    return Array.from(this.auctionRooms.keys());
  }

  public getAuctionParticipants(auctionId: string): number {
    return this.auctionRooms.get(auctionId)?.size || 0;
  }

  async cleanup(): Promise<void> {
    this.io.close();
    await this.prisma.$disconnect();
  }
}