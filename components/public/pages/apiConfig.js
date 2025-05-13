import { API_BASE_URL } from '../../config/api';

fetch(`${API_BASE_URL}/orders`)

// For React/Vite/Next.js, process.env.NEXT_PUBLIC_API_URL will be replaced at build time.
// For plain HTML/JS, you can set window.NEXT_PUBLIC_API_URL before your scripts run.

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";