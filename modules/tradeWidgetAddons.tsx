import React from 'react';

export function SettingsTab({ recipientToggleState, hooksEnabledState, deadlineState }: any) {
  return (
    <div>
      <h3>Settings</h3>
      <p>Recipient Toggle: {recipientToggleState ? 'Enabled' : 'Disabled'}</p>
      <p>Hooks Enabled: {hooksEnabledState ? 'Yes' : 'No'}</p>
      <p>Deadline: {deadlineState}</p>
    </div>
  );
}

export function TradeRateDetails({ isTradePriceUpdating, rateInfoParams, deadline }: any) {
  return (
    <div>
      <h3>Trade Rate Details</h3>
      <p>Price Updating: {isTradePriceUpdating ? 'Yes' : 'No'}</p>
      <p>Rate Info: {JSON.stringify(rateInfoParams)}</p>
      <p>Deadline: {deadline}</p>
    </div>
  );
}