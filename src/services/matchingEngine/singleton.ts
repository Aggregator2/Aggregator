
import { EnhancedMatchingEngine } from './EnhancedMatchingEngine';

export const matchingEngine = new EnhancedMatchingEngine({ persist: true });

export function getMatchingEngine(): EnhancedMatchingEngine {
  return matchingEngine;
}
