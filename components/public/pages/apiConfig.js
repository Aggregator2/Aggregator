import { API_BASE_URL } from '../../config/api';


fetch(`${API_BASE_URL}/orders`)

// For React/Vite/Next.js, process.env.NEXT_PUBLIC_API_URL will be replaced at build time.
// For plain HTML/JS, you can set window.NEXT_PUBLIC_API_URL before your scripts run.

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
export const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "ce875464-1d55-4097-830b-9f241b299fdb";

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}