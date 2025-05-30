// ...inside SwapWidget component...
import EscrowABI from "../artifacts/contracts/Escrow.sol/Escrow.json";
import { ESCROW_CONTRACT_ADDRESS } from "../frontend/src/config/escrowAddress";
import { getAddress } from 'ethers';

useEffect(() => {
  const fetchOwner = async () => {
    if (!window.ethereum) return;
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const contract = new ethers.Contract(
      ESCROW_CONTRACT_ADDRESS,
      EscrowABI.abi,
      provider
    );
    try {
      const owner = await contract.owner();
      console.log("Escrow contract owner:", owner);
    } catch (err) {
      console.error("Failed to fetch owner:", err);
    }
  };
  fetchOwner();
}, []);

console.log(getAddress("0x5fbD2311576a8fceb3f763249f642fc4180a0aa3"));