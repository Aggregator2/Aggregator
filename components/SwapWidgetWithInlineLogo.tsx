// Alternative logo placement - inline with title (like CowSwap)
// To use this version, replace the logoContainer section in SwapWidget.tsx with:

/*
Replace this:
          <div className={styles.logoContainer}>
            <img 
              src="/logo.svg" 
              alt="DEX Logo" 
              className={styles.logo}
            />
          </div>
          <div className={styles.tradeHeader}>
            <div className={styles.tradeTitle}>
              Swap

With this:
          <div className={styles.tradeHeader}>
            <div className={styles.tradeTitle}>
              <img 
                src="/logo.svg" 
                alt="DEX Logo" 
                className={styles.logoInline}
              />
              <span>Swap</span>

And add this CSS to SwapWidget.module.css:

.logoInline {
  width: 32px;
  height: 32px;
  object-fit: contain;
  margin-right: 8px;
}

.tradeTitle {
  font-size: 22px;
  font-weight: 700;
  color: white;
  display: flex;
  align-items: center;
  gap: 8px;
}

.tradeTitle span {
  display: flex;
  align-items: center;
  gap: 8px;
}

*/