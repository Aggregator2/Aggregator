import React from 'react';

// filepath: c:\Users\joeri\OneDrive\Desktop\Meta Aggregator 2.0\pages\index.js
export default function Home() {
  return (
    <div>
      <head>
        <title>TradeGuard - Smarter Trading</title>
        <link rel="stylesheet" href="/styles.css" />
        <link rel="stylesheet" href="/homepage.css" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Sora:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Top Navigation */}
        <nav className="top-nav">
          <div className="logo">TradeGuard</div>
          <ul className="nav-links">
            <li><a href="#home">Home</a></li>
            <li><a href="#how-it-works">How It Works</a></li>
            <li><a href="#features">Features</a></li>
            <li><a href="#faq">FAQ</a></li>
            <li><a href="#contact">Contact</a></li>
          </ul>
          <button className="cta-btn">Get Early Access</button>
        </nav>

        {/* Hero Section */}
        <section id="home" className="hero">
          <div className="hero-content">
            <h1>The more you lose, the more they win.</h1>
            <p>
              This DEX can be the difference between you being profitable or not. We say no to hidden slippage, slow execution, and silent manipulation.
            </p>
            <div className="hero-buttons">
              <button className="primary-btn">Get Early Access</button>
              <button className="secondary-btn">Learn How It Works</button>
            </div>
          </div>
        </section>

        {/* Add other sections here, following the same JSX conversion */}
      </body>
    </div>
  );
}