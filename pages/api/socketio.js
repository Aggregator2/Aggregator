// Socket.io endpoint
export default function handler(req, res) {
  // This endpoint is handled by socket.io
  res.end();
}

export const config = {
  api: {
    bodyParser: false,
  },
};