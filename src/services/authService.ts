import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

export interface RegisterInput {
  email: string;
  password: string;
  walletAddress?: string;
  firstName?: string;
  lastName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  walletAddress?: string;
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
}

export class AuthService {
  private readonly saltRounds = 10;
  private readonly jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
  private readonly jwtExpiresIn = '7d';

  async register(input: RegisterInput) {
    const existingUser = await prisma.User.findFirst({
      where: {
        OR: [
          { email: input.email },
          input.walletAddress ? { walletAddress: input.walletAddress } : {}
        ].filter(Boolean)
      }
    });

    if (existingUser) {
      if (existingUser.email === input.email) {
        throw new Error('Email already registered');
      }
      if (input.walletAddress && existingUser.walletAddress === input.walletAddress) {
        throw new Error('Wallet address already registered');
      }
    }

    const hashedPassword = await bcrypt.hash(input.password, this.saltRounds);

    const user = await prisma.User.create({
      data: {
        email: input.email,
        password: hashedPassword,
        walletAddress: input.walletAddress,
        firstName: input.firstName,
        lastName: input.lastName
      },
      select: {
        id: true,
        email: true,
        walletAddress: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true
      }
    });

    const token = this.generateToken({
      userId: user.id,
      email: user.email,
      role: user.role
    });

    return {
      user,
      token
    };
  }

  async login(input: LoginInput) {
    const user = await prisma.User.findUnique({
      where: { email: input.email }
    });

    if (!user || !user.isActive) {
      throw new Error('Invalid credentials');
    }

    const isValidPassword = await bcrypt.compare(input.password, user.password);
    if (!isValidPassword) {
      throw new Error('Invalid credentials');
    }

    const token = this.generateToken({
      userId: user.id,
      email: user.email,
      role: user.role
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        walletAddress: user.walletAddress,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      },
      token
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput) {
    if (input.walletAddress) {
      const existingUser = await prisma.User.findFirst({
        where: {
          walletAddress: input.walletAddress,
          NOT: { id: userId }
        }
      });

      if (existingUser) {
        throw new Error('Wallet address already in use');
      }
    }

    const updatedUser = await prisma.User.update({
      where: { id: userId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        walletAddress: input.walletAddress
      },
      select: {
        id: true,
        email: true,
        walletAddress: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return updatedUser;
  }

  async getProfile(userId: string) {
    const user = await prisma.User.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        walletAddress: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { orders: true }
        }
      }
    });

    if (!user) {
      throw new Error('User not found');
    }

    return user;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.User.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error('User not found');
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      throw new Error('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, this.saltRounds);

    await prisma.User.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    return { message: 'Password changed successfully' };
  }

  generateToken(payload: JWTPayload): string {
    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn
    });
  }

  verifyToken(token: string): JWTPayload {
    try {
      return jwt.verify(token, this.jwtSecret) as JWTPayload;
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }
}

export const authService = new AuthService();