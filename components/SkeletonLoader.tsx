import React from 'react';
import styles from './SkeletonLoader.module.css';

interface SkeletonLoaderProps {
  variant?: 'text' | 'rectangular' | 'circular' | 'quote' | 'token' | 'button';
  width?: string | number;
  height?: string | number;
  lines?: number;
  className?: string;
}

const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  variant = 'text',
  width = '100%',
  height,
  lines = 1,
  className = '',
}) => {
  const getDefaultHeight = () => {
    switch (variant) {
      case 'text':
        return '1.2em';
      case 'rectangular':
        return '200px';
      case 'circular':
        return '40px';
      case 'quote':
        return '120px';
      case 'token':
        return '60px';
      case 'button':
        return '48px';
      default:
        return '1.2em';
    }
  };

  const skeletonHeight = height || getDefaultHeight();
  const skeletonWidth = variant === 'circular' ? skeletonHeight : width;

  if (variant === 'text' && lines > 1) {
    return (
      <div className={`${styles.skeletonContainer} ${className}`}>
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className={`${styles.skeleton} ${styles.text}`}
            style={{
              width: index === lines - 1 ? '80%' : '100%',
              height: skeletonHeight,
              marginBottom: index === lines - 1 ? 0 : '0.5em',
            }}
          />
        ))}
      </div>
    );
  }

  if (variant === 'quote') {
    return (
      <div className={`${styles.skeletonContainer} ${styles.quoteContainer} ${className}`}>
        <div className={`${styles.skeleton} ${styles.rectangular}`} style={{ height: '20px', marginBottom: '0.75rem' }} />
        <div className={`${styles.skeleton} ${styles.rectangular}`} style={{ height: '16px', width: '60%', marginBottom: '0.5rem' }} />
        <div className={`${styles.skeleton} ${styles.rectangular}`} style={{ height: '16px', width: '80%', marginBottom: '0.5rem' }} />
        <div className={`${styles.skeleton} ${styles.rectangular}`} style={{ height: '16px', width: '40%' }} />
      </div>
    );
  }

  if (variant === 'token') {
    return (
      <div className={`${styles.skeletonContainer} ${styles.tokenContainer} ${className}`}>
        <div className={`${styles.skeleton} ${styles.circular}`} style={{ width: '32px', height: '32px' }} />
        <div className={styles.tokenInfo}>
          <div className={`${styles.skeleton} ${styles.rectangular}`} style={{ height: '16px', width: '60px', marginBottom: '4px' }} />
          <div className={`${styles.skeleton} ${styles.rectangular}`} style={{ height: '14px', width: '40px' }} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${styles.skeleton} ${styles[variant]} ${className}`}
      style={{
        width: skeletonWidth,
        height: skeletonHeight,
      }}
    />
  );
};

export default SkeletonLoader;
