import { useEffect } from 'react';
import '../components/globals.css'; // Tailwind/global styles
import '../components/public/styles.css'; // Your custom global CSS (if needed)
import '../components/homepage.js'; // Your custom global CSS (if needed)
import '../src/styles/animations.css'; // AnimatedBackground styles
import { TokenMonitoringService } from '../src/services/tokenMonitoringService';

export default function App({ Component, pageProps }) {
  useEffect(() => {
    // Only initialize on client side
    if (typeof window !== 'undefined') {
      // Initialize token monitoring service when app starts
      TokenMonitoringService.initialize().catch(console.error);
      
      // Cleanup on unmount
      return () => {
        TokenMonitoringService.stopPeriodicUpdates();
      };
    }
  }, []);
  
  return <Component {...pageProps} />;
}