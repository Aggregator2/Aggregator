describe('Frontend test', () => {
  it('loads homepage and shows expected title and heading', () => {
    // Visit the deployed Vercel URL
    cy.visit('https://aggregator-lac.vercel.app');

    // Verify the page title
    cy.title().should('eq', 'TradeGuard - Smarter Trading (Test)');

    // Verify the presence of a specific heading or text
    cy.contains('The more you lose, the more they win.');
  });
});