import '../components/globals.css'; // Tailwind/global styles
import '../components/public/styles.css'; // Your custom global CSS (if needed)
import '../components/homepage.js'; // Your custom global CSS (if needed)
import '../src/styles/animations.css'; // AnimatedBackground styles

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}