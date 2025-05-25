export function useRateInfoParams(inputAmount: any, outputAmount: any) {
  return {
    rate: inputAmount && outputAmount ? inputAmount / outputAmount : null,
  };
}