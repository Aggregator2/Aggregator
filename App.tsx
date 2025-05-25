import React, { useState } from "react";
import SwapWidget from "./components/SwapWidget";

const App = () => {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const connectWallet = async () => {
    try {
      if (window.ethereum) {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        const signer = provider.getSigner();
        const address = await signer.getAddress();
        setWalletAddress(address);
        console.log("Wallet connected:", address);
      } else {
        alert("MetaMask is not installed!");
      }
    } catch (error) {
      console.error("Failed to connect wallet:", error);
      alert("Failed to connect wallet. Please try again.");
    }
  };

  return (
    <div>
      <button onClick={connectWallet}>
        {walletAddress ? "Wallet Connected" : "Connect Wallet"}
      </button>
      <SwapWidget userWalletAddress={walletAddress} />
    </div>
  );
};

export default App;