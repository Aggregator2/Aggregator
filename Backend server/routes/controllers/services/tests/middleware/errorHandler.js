function errorHandler(err, req, res, next) {
    console.error(`[${req.method}] ${req.path} - Status: ${err.status} - Error: ${err.message}`);
    res.status(err.status || 500).json({ error: "Something went wrong." });
}

module.exports = errorHandler;