import { useMemo } from 'react';

export const useSafeMemoObject = (obj: any) => {
  return useMemo(() => obj, [obj]);
};