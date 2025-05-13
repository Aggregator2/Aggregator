module.exports = async (req, res) => {
  if (
    !process.env.CONTRACT_ADDRESS ||
    process.env.CONTRACT_ADDRESS === '0x000000000000000000000000000000000000dead'
  ) {
    return res.status(400).json({ error: 'Contract not yet deployed' });
  }

  res.status(200).json({ message: 'Execute route reached' });
};