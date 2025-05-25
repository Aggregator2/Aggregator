import React from 'react';

interface WarningsProps {
  warnings: string[];
}

export function Warnings({ warnings }: WarningsProps) {
  return (
    <div>
      <h3>Warnings</h3>
      {warnings.length > 0 ? (
        <ul>
          {warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : (
        <p>No warnings</p>
      )}
    </div>
  );
}