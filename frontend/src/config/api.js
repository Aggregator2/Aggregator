import { API_BASE_URL } from '../config/api'; // Adjust the path as needed

fetch(`${API_BASE_URL}/orders`)

// For React/Vite/Next.js, process.env.NEXT_PUBLIC_API_URL will be replaced at build time.
// For plain HTML/JS, you can set window.NEXT_PUBLIC_API_URL before your scripts run.

export const API_BASE_URL =
  window.NEXT_PUBLIC_API_URL || "https://aggregator-josephs-projects-45894699.vercel.app/api";