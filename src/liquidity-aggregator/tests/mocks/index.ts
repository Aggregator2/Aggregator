import { MockProvider, MockContract } from './MockProvider';
import { MockWebSocket } from './MockWebSocket';

export { MockProvider, MockContract, MockWebSocket };

// Mock ethers module
export const ethers = {
  Contract: MockContract as any,
  ZeroAddress: '0x0000000000000000000000000000000000000000',
  parseEther: (value: string) => BigInt(value) * BigInt('1000000000000000000'),
  formatEther: (value: bigint) => (Number(value) / 1e18).toString(),
  formatUnits: (value: bigint, decimals: number) => {
    const divisor = BigInt(10 ** decimals);
    return (Number(value) / Number(divisor)).toString();
  },
  parseUnits: (value: string, decimals: number) => {
    const multiplier = BigInt(10 ** decimals);
    return BigInt(Math.floor(parseFloat(value) * Number(multiplier)));
  },
  zeroPadBytes: (value: string, length: number) => {
    return value.padEnd(length * 2, '0');
  }
};