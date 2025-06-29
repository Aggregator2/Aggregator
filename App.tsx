import React, { useState } from "react";
import { ethers } from "ethers";
import SwapWidget from "./components/SwapWidget";

const App = () => {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const connectWallet = async () => {
    try {
      if (!window.ethereum) {
        alert("MetaMask is not installed!");
        return;
      }
      
      // Check for existing pending requests
      try {
        const existingAccounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (existingAccounts && existingAccounts.length > 0) {
          setWalletAddress(existingAccounts[0]);
          console.log("Already connected:", existingAccounts[0]);
          return;
        }
      } catch (checkError) {
        const checkErr = checkError as any;
        if (checkErr.code === -32002) {
          alert("Connection request already pending. Please check MetaMask.");
          return;
        }
      }
      
      const provider = new ethers.BrowserProvider(window.ethereum);
      
      try {
        // Request accounts with proper error handling
        const accounts = await provider.send("eth_requestAccounts", []);
        if (accounts && accounts.length > 0) {
          setWalletAddress(accounts[0]);
          console.log("Wallet connected:", accounts[0]);
        }
      } catch (error) {
        const err = error as any;
        if (err.code === -32002) {
          alert("Connection request already pending. Please check MetaMask.");
        } else if (err.code === 4001) {
          console.log("User rejected connection");
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error("Failed to connect wallet:", error);
      alert("Failed to connect wallet. Please try again.");
    }
  };

  return (
    <>
      <button onClick={connectWallet}>
        {walletAddress ? "Wallet Connected" : "Connect Wallet"}
      </button>
      <SwapWidget userWalletAddress={walletAddress || ""} />
    </>
  );
};

export default App;