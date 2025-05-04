module.exports = (req, res) => {
  res.status(200).json({
    pair: 'ETH/USDC',
    price: '1872.50',
    expiresIn: '30s'
  });
};