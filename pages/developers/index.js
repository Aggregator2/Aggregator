import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../../styles/DeveloperPortal.module.css';

const DeveloperPortal = () => {
  const [activeSection, setActiveSection] = useState('overview');

  const quickLinks = [
    {
      title: 'API Reference',
      description: 'Complete REST API documentation with interactive examples',
      href: '/developers/api',
      icon: '🔌',
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    },
    {
      title: 'SDK Documentation',
      description: 'TypeScript/JavaScript SDK for seamless integration',
      href: '/developers/sdk',
      icon: '📦',
      gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)'
    },
    {
      title: 'Integration Guides',
      description: 'Step-by-step tutorials for common use cases',
      href: '/developers/guides',
      icon: '📖',
      gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'
    },
    {
      title: 'Code Examples',
      description: 'Production-ready code samples and templates',
      href: '/developers/examples',
      icon: '💻',
      gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'
    }
  ];

  const features = [
    {
      title: 'Off-Chain Settlement',
      description: 'Gasless order creation with MEV protection',
      features: [
        'EIP-712 signature-based orders',
        'No gas fees for order creation',
        'Batch settlement capabilities',
        'Cross-chain order support'
      ]
    },
    {
      title: 'Liquidity Aggregation',
      description: 'Access to multiple liquidity sources',
      features: [
        '0x Protocol integration',
        '1inch API support',
        'Paraswap connectivity',
        'Custom solver network'
      ]
    },
    {
      title: 'Advanced Features',
      description: 'Enterprise-grade trading infrastructure',
      features: [
        'State channels for HFT',
        'MEV protection built-in',
        'Limit order support',
        'Cross-chain swaps'
      ]
    }
  ];

  return (
    <>
      <Head>
        <title>Swappiq Developer Portal - API Documentation & SDKs</title>
        <meta name="description" content="Build on Swappiq's off-chain settlement protocol. Access our APIs, SDKs, and comprehensive documentation." />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className={styles.developerPortal}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerContent}>
            <Link href="/" className={styles.logo}>
              <img src="/images/swappiq-logo.png" alt="Swappiq" />
            </Link>
            <nav className={styles.nav}>
              <Link href="/developers">Overview</Link>
              <Link href="/developers/api">API</Link>
              <Link href="/developers/sdk">SDK</Link>
              <Link href="/developers/guides">Guides</Link>
              <Link href="/developers/examples">Examples</Link>
              <a href="https://github.com/swappiq" target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
            </nav>
          </div>
        </header>

        {/* Hero Section */}
        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <h1 className={styles.heroTitle}>
              Build on Swappiq
            </h1>
            <p className={styles.heroDescription}>
              The most advanced off-chain settlement protocol. Create gasless trades, 
              aggregate liquidity, and protect users from MEV.
            </p>
            <div className={styles.heroButtons}>
              <Link href="/developers/guides/quickstart" className={styles.primaryButton}>
                Quick Start Guide
              </Link>
              <Link href="/developers/api" className={styles.secondaryButton}>
                Explore API
              </Link>
            </div>
            <div className={styles.heroStats}>
              <div className={styles.stat}>
                <span className={styles.statValue}>0 Gas</span>
                <span className={styles.statLabel}>Order Creation</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statValue}>100ms</span>
                <span className={styles.statLabel}>Quote Response</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statValue}>MEV</span>
                <span className={styles.statLabel}>Protected</span>
              </div>
            </div>
          </div>
        </section>

        {/* Quick Links */}
        <section className={styles.quickLinks}>
          <div className={styles.container}>
            <h2 className={styles.sectionTitle}>Developer Resources</h2>
            <div className={styles.linkGrid}>
              {quickLinks.map((link, index) => (
                <Link key={index} href={link.href} className={styles.linkCard}>
                  <div 
                    className={styles.linkIcon} 
                    style={{ background: link.gradient }}
                  >
                    <span>{link.icon}</span>
                  </div>
                  <h3>{link.title}</h3>
                  <p>{link.description}</p>
                  <span className={styles.linkArrow}>→</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Features Overview */}
        <section className={styles.features}>
          <div className={styles.container}>
            <h2 className={styles.sectionTitle}>Protocol Features</h2>
            <div className={styles.featureGrid}>
              {features.map((feature, index) => (
                <div key={index} className={styles.featureCard}>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                  <ul className={styles.featureList}>
                    {feature.features.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Code Preview */}
        <section className={styles.codePreview}>
          <div className={styles.container}>
            <h2 className={styles.sectionTitle}>Get Started in Minutes</h2>
            <div className={styles.codeGrid}>
              <div className={styles.codeBlock}>
                <h3>Install SDK</h3>
                <pre>
                  <code>{`npm install @swappiq/sdk
# or
yarn add @swappiq/sdk`}</code>
                </pre>
              </div>
              <div className={styles.codeBlock}>
                <h3>Create Your First Order</h3>
                <pre>
                  <code>{`import { SwappiqSDK } from '@swappiq/sdk';

const sdk = new SwappiqSDK({
  apiKey: 'YOUR_API_KEY'
});

const quote = await sdk.getQuote({
  sellToken: 'WETH',
  buyToken: 'USDC',
  sellAmount: '1000000000000000000'
});

const order = await sdk.createOrder(quote);
const signature = await sdk.signOrder(order);`}</code>
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* Integration Partners */}
        <section className={styles.partners}>
          <div className={styles.container}>
            <h2 className={styles.sectionTitle}>Liquidity Partners</h2>
            <div className={styles.partnerLogos}>
              <div className={styles.partnerLogo}>0x Protocol</div>
              <div className={styles.partnerLogo}>1inch</div>
              <div className={styles.partnerLogo}>Paraswap</div>
              <div className={styles.partnerLogo}>OpenOcean</div>
              <div className={styles.partnerLogo}>LiFi</div>
            </div>
          </div>
        </section>

        {/* Support Section */}
        <section className={styles.support}>
          <div className={styles.container}>
            <h2 className={styles.sectionTitle}>Need Help?</h2>
            <div className={styles.supportGrid}>
              <div className={styles.supportCard}>
                <h3>Discord Community</h3>
                <p>Join our developer community for real-time support</p>
                <a href="#" className={styles.supportLink}>Join Discord →</a>
              </div>
              <div className={styles.supportCard}>
                <h3>GitHub Issues</h3>
                <p>Report bugs or request features on GitHub</p>
                <a href="#" className={styles.supportLink}>Open Issue →</a>
              </div>
              <div className={styles.supportCard}>
                <h3>Email Support</h3>
                <p>Get direct support from our team</p>
                <a href="mailto:developers@swappiq.io" className={styles.supportLink}>
                  developers@swappiq.io →
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className={styles.footer}>
          <div className={styles.container}>
            <div className={styles.footerContent}>
              <div className={styles.footerSection}>
                <h4>Documentation</h4>
                <Link href="/developers/api">API Reference</Link>
                <Link href="/developers/sdk">SDK Guide</Link>
                <Link href="/developers/guides">Tutorials</Link>
              </div>
              <div className={styles.footerSection}>
                <h4>Resources</h4>
                <a href="#">Whitepaper</a>
                <a href="#">Security Audits</a>
                <a href="#">Brand Assets</a>
              </div>
              <div className={styles.footerSection}>
                <h4>Community</h4>
                <a href="#">Discord</a>
                <a href="#">Twitter</a>
                <a href="#">GitHub</a>
              </div>
            </div>
            <div className={styles.footerBottom}>
              <p>&copy; 2024 Swappiq Protocol. All rights reserved.</p>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
};

export default DeveloperPortal;