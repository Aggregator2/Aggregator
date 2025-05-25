import React from 'react';

interface BottomBannersProps {
  banners: string[];
}

export function BottomBanners({ banners }: BottomBannersProps) {
  return (
    <div>
      <h3>Bottom Banners</h3>
      {banners.length > 0 ? (
        <ul>
          {banners.map((banner, index) => (
            <li key={index}>{banner}</li>
          ))}
        </ul>
      ) : (
        <p>No banners</p>
      )}
    </div>
  );
}