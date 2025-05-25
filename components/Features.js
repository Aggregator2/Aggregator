// Features section
export default function Features() {
  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-center mb-8">Key Features</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-center">
        <div className="p-4 bg-white rounded shadow">
          {/* Icon placeholder */}
          <h3 className="text-xl font-semibold">Best Price</h3>
          <p>Get best quotes off-chain from DEXs and CEXs to ensure optimal trades.</p>
        </div>
        <div className="p-4 bg-white rounded shadow">
          {/* Icon placeholder */}
          <h3 className="text-xl font-semibold">Wallet Controlled</h3>
          <p>Funds stay with you until you provide a signature to execute a trade.</p>
        </div>
        <div className="p-4 bg-white rounded shadow">
          {/* Icon placeholder */}
          <h3 className="text-xl font-semibold">No Front-Running</h3>
          <p>Orders are executed privately to avoid MEV and protect your trades.</p>
        </div>
        <div className="p-4 bg-white rounded shadow">
          {/* Icon placeholder */}
          <h3 className="text-xl font-semibold">Fallback Safety</h3>
          <p>Auto on-chain execution if off-chain fails, ensuring trade always completes.</p>
        </div>
      </div>
    </div>
  );
}
