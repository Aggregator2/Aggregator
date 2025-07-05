// Simple test endpoint to verify basic functionality
const handler = async (req, res) => {
  res.status(200).json({
    message: 'API is working',
    env: {
      hasJwtSecret: !!process.env.JWT_SECRET,
      nodeEnv: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    }
  });
};

module.exports = handler;