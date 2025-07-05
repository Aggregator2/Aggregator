import { EventEmitter } from 'events';
import { Trade } from '../matchingEngine/types';
import { SettlementBatch } from './types';

interface NettingNode {
  userId: string;
  token: string;
  amount: bigint;
  originalAmount: bigint;
}

interface NettingGraph {
  nodes: Map<string, NettingNode>;
  edges: Map<string, Set<string>>;
}

export class NettingEngine extends EventEmitter {
  private nettingThreshold: number = 0.1; // 10% minimum reduction for netting
  
  constructor() {
    super();
  }
  
  // Clear all state - for testing
  public clear(): void {
    this.removeAllListeners();
  }
  
  // Calculate net positions for all users across all tokens
  public async calculateNetPositions(
    trades: Trade[]
  ): Promise<Map<string, Map<string, bigint>>> {
    const positions = new Map<string, Map<string, bigint>>();
    
    // First, calculate gross positions
    const grossPositions = this.calculateGrossPositions(trades);
    
    // Apply multilateral netting
    const nettedPositions = await this.applyMultilateralNetting(grossPositions);
    
    // Emit netting results
    this.emit('nettingCompleted', {
      gross: grossPositions,
      net: nettedPositions,
      reduction: this.calculateReduction(grossPositions, nettedPositions)
    });
    
    return nettedPositions;
  }
  
  // Calculate gross positions before netting
  private calculateGrossPositions(trades: Trade[]): Map<string, Map<string, bigint>> {
    const positions = new Map<string, Map<string, bigint>>();
    
    for (const trade of trades) {
      const baseToken = this.getBaseToken(trade.pair);
      const quoteToken = this.getQuoteToken(trade.pair);
      
      // Validate trade data
      if (!isFinite(trade.price) || !isFinite(trade.filledQuantity) || trade.price <= 0 || trade.filledQuantity <= 0) {
        console.warn(`Skipping invalid trade:`, { price: trade.price, filledQuantity: trade.filledQuantity, id: trade.id });
        continue;
      }
      
      const tradeValue = BigInt(Math.floor(trade.price * trade.filledQuantity * 1e8)); // 8 decimals precision
      const quantity = BigInt(Math.floor(trade.filledQuantity * 1e8));
      
      // Buyer receives base token, pays quote token
      this.updatePosition(positions, trade.buyerId, baseToken, quantity);
      this.updatePosition(positions, trade.buyerId, quoteToken, -tradeValue);
      
      // Seller pays base token, receives quote token
      this.updatePosition(positions, trade.sellerId, baseToken, -quantity);
      this.updatePosition(positions, trade.sellerId, quoteToken, tradeValue);
      
      // Account for fees
      if (trade.buyerFee > 0) {
        const buyerFee = BigInt(Math.floor(trade.buyerFee * 1e8));
        this.updatePosition(positions, trade.buyerId, quoteToken, -buyerFee);
      }
      
      if (trade.sellerFee > 0) {
        const sellerFee = BigInt(Math.floor(trade.sellerFee * 1e8));
        this.updatePosition(positions, trade.sellerId, quoteToken, -sellerFee);
      }
    }
    
    return positions;
  }
  
  // Apply multilateral netting algorithm
  private async applyMultilateralNetting(
    grossPositions: Map<string, Map<string, bigint>>
  ): Promise<Map<string, Map<string, bigint>>> {
    const nettingGraphs = new Map<string, NettingGraph>();
    
    // Build netting graphs for each token
    for (const [userId, userPositions] of grossPositions) {
      for (const [token, amount] of userPositions) {
        if (!nettingGraphs.has(token)) {
          nettingGraphs.set(token, {
            nodes: new Map(),
            edges: new Map()
          });
        }
        
        const graph = nettingGraphs.get(token)!;
        graph.nodes.set(userId, {
          userId,
          token,
          amount,
          originalAmount: amount
        });
      }
    }
    
    // Apply netting algorithms for each token
    const nettedPositions = new Map<string, Map<string, bigint>>();
    
    for (const [token, graph] of nettingGraphs) {
      // Run netting algorithms in sequence
      this.applyBilateralNetting(graph);
      this.applyCyclicNetting(graph);
      this.applyCompressionNetting(graph);
      
      // Extract netted positions
      for (const [userId, node] of graph.nodes) {
        if (!nettedPositions.has(userId)) {
          nettedPositions.set(userId, new Map());
        }
        
        if (node.amount !== BigInt(0)) {
          nettedPositions.get(userId)!.set(token, node.amount);
        }
      }
    }
    
    return nettedPositions;
  }
  
  // Apply bilateral netting between counterparties
  private applyBilateralNetting(graph: NettingGraph): void {
    const nodes = Array.from(graph.nodes.values());
    
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const node1 = nodes[i];
        const node2 = nodes[j];
        
        // Check if they have opposite positions
        if ((node1.amount > 0 && node2.amount < 0) || 
            (node1.amount < 0 && node2.amount > 0)) {
          
          // Calculate netting amount
          const nettingAmount = node1.amount > 0 
            ? bigIntMin(node1.amount, -node2.amount)
            : bigIntMin(-node1.amount, node2.amount);
          
          if (nettingAmount > 0) {
            // Apply netting
            if (node1.amount > 0) {
              node1.amount -= nettingAmount;
              node2.amount += nettingAmount;
            } else {
              node1.amount += nettingAmount;
              node2.amount -= nettingAmount;
            }
            
            // Record edge for visualization
            if (!graph.edges.has(node1.userId)) {
              graph.edges.set(node1.userId, new Set());
            }
            graph.edges.get(node1.userId)!.add(node2.userId);
          }
        }
      }
    }
  }
  
  // Apply cyclic netting to eliminate circular debts
  private applyCyclicNetting(graph: NettingGraph): void {
    const cycles = this.findCycles(graph);
    
    for (const cycle of cycles) {
      // Find minimum amount in cycle
      let minAmount = BigInt(Number.MAX_SAFE_INTEGER);
      
      for (let i = 0; i < cycle.length; i++) {
        const node = graph.nodes.get(cycle[i])!;
        const absAmount = node.amount < 0 ? -node.amount : node.amount;
        minAmount = bigIntMin(minAmount, absAmount);
      }
      
      // Apply cycle reduction
      if (minAmount > 0) {
        for (const userId of cycle) {
          const node = graph.nodes.get(userId)!;
          if (node.amount > 0) {
            node.amount -= minAmount;
          } else {
            node.amount += minAmount;
          }
        }
      }
    }
  }
  
  // Apply compression netting to reduce number of settlements
  private applyCompressionNetting(graph: NettingGraph): void {
    // Find central clearing parties (users with many connections)
    const connectionCounts = new Map<string, number>();
    
    for (const [userId, connections] of graph.edges) {
      connectionCounts.set(userId, connections.size);
    }
    
    // Sort by connection count
    const sortedUsers = Array.from(connectionCounts.entries())
      .sort((a, b) => b[1] - a[1]);
    
    if (sortedUsers.length === 0) return;
    
    // Use top user as compression hub
    const hubUserId = sortedUsers[0][0];
    const hubNode = graph.nodes.get(hubUserId);
    
    if (!hubNode) return;
    
    // Route small payments through hub
    const compressionThreshold = BigInt(1000000); // Threshold for compression
    
    for (const [userId, node] of graph.nodes) {
      if (userId !== hubUserId && 
          node.amount !== BigInt(0) && 
          bigIntAbs(node.amount) < compressionThreshold) {
        
        // Transfer obligation to hub
        hubNode.amount += node.amount;
        node.amount = BigInt(0);
      }
    }
  }
  
  // Find cycles in the netting graph using DFS
  private findCycles(graph: NettingGraph): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const dfs = (userId: string, path: string[]): void => {
      visited.add(userId);
      recursionStack.add(userId);
      path.push(userId);
      
      const edges = graph.edges.get(userId) || new Set();
      
      for (const neighbor of edges) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, [...path]);
        } else if (recursionStack.has(neighbor)) {
          // Found a cycle
          const cycleStart = path.indexOf(neighbor);
          if (cycleStart !== -1) {
            cycles.push(path.slice(cycleStart));
          }
        }
      }
      
      recursionStack.delete(userId);
    };
    
    // Run DFS from each unvisited node
    for (const userId of graph.nodes.keys()) {
      if (!visited.has(userId)) {
        dfs(userId, []);
      }
    }
    
    return cycles;
  }
  
  // Calculate netting efficiency
  public calculateNettingEfficiency(batch: SettlementBatch): number {
    let totalGross = BigInt(0);
    let totalNet = BigInt(0);
    
    for (const settlement of batch.settlements) {
      for (const position of settlement.netAmounts) {
        totalGross += bigIntAbs(position.originalAmount);
        totalNet += bigIntAbs(position.netAmount);
      }
    }
    
    if (totalGross === BigInt(0)) return 0;
    
    const efficiency = Number(totalGross - totalNet) / Number(totalGross);
    return Math.round(efficiency * 10000) / 100; // Return as percentage
  }
  
  // Calculate total reduction from netting
  private calculateReduction(
    gross: Map<string, Map<string, bigint>>,
    net: Map<string, Map<string, bigint>>
  ): bigint {
    let grossTotal = BigInt(0);
    let netTotal = BigInt(0);
    
    for (const [userId, positions] of gross) {
      for (const [token, amount] of positions) {
        grossTotal += bigIntAbs(amount);
      }
    }
    
    for (const [userId, positions] of net) {
      for (const [token, amount] of positions) {
        netTotal += bigIntAbs(amount);
      }
    }
    
    return grossTotal - netTotal;
  }
  
  // Update position helper
  private updatePosition(
    positions: Map<string, Map<string, bigint>>,
    userId: string,
    token: string,
    amount: bigint
  ): void {
    if (!positions.has(userId)) {
      positions.set(userId, new Map());
    }
    
    const userPositions = positions.get(userId)!;
    const currentAmount = userPositions.get(token) || BigInt(0);
    userPositions.set(token, currentAmount + amount);
  }
  
  // Helper methods
  private getBaseToken(pair: string): string {
    return pair.split('/')[0];
  }
  
  private getQuoteToken(pair: string): string {
    return pair.split('/')[1];
  }
  
  // Set netting threshold
  public setNettingThreshold(threshold: number): void {
    this.nettingThreshold = threshold;
  }
  
  // Get netting statistics
  public getNettingStats(): any {
    return {
      threshold: this.nettingThreshold,
      algorithmsEnabled: ['bilateral', 'cyclic', 'compression']
    };
  }
}

// Helper functions for BigInt operations
function bigIntMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function bigIntAbs(a: bigint): bigint {
  return a < 0 ? -a : a;
}