import React from 'react';

interface BridgeQuoteDetailsProps {
  details: any;
  outputCurrency: any;
}

export function BridgeQuoteDetails({ details, outputCurrency }: BridgeQuoteDetailsProps) {
  return (
    <div>
      <h3>Bridge Quote Details</h3>
      <p>Details: {JSON.stringify(details)}</p>
      <p>Output Currency: {outputCurrency}</p>
    </div>
  );
}