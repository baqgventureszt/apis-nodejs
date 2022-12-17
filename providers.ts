import { NetworkName, sdk } from "@ragetrade/sdk";
import { config } from "dotenv";
import { ethers } from "ethers";

config();

export const arbmain = new ethers.providers.StaticJsonRpcProvider(
  // "https://arb1.arbitrum.io/rpc"
  "https://arb-mainnet.g.alchemy.com/v2/" + process.env.ALCHEMY_KEY
);
export const arbtest = new ethers.providers.StaticJsonRpcProvider(
  // "https://rinkeby.arbitrum.io/rpc"
  "https://arb-rinkeby.g.alchemy.com/v2/" + process.env.ALCHEMY_KEY
);
export const arbgoerli = new ethers.providers.StaticJsonRpcProvider(
  "https://arb-goerli.g.alchemy.com/v2/" + process.env.ALCHEMY_KEY
);
// sdk.getProvider("arbgoerli");

export function getProvider(
  networkName: NetworkName
): ethers.providers.Provider {
  switch (networkName) {
    case "arbmain":
      return arbmain;
    case "arbtest":
    case "arbrinkeby":
      return arbtest;
    case "arbgoerli":
      return arbgoerli;
    default:
      throw new Error(`Provider not available for the network: ${networkName}`);
  }
}

// This is separate from the above function because the aggregate apis make a lot of requests
export function getProviderAggregate(
  networkName: NetworkName
): ethers.providers.Provider {
  switch (networkName) {
    case "arbmain":
      return new ethers.providers.StaticJsonRpcProvider(
        "https://arb-mainnet.g.alchemy.com/v2/" +
          process.env.ALCHEMY_KEY_AGGREGATE
      );
    case "arbgoerli":
      return new ethers.providers.StaticJsonRpcProvider(
        "https://arb-goerli.g.alchemy.com/v2/" +
          process.env.ALCHEMY_KEY_AGGREGATE
      );
    default:
      throw new Error(
        `Aggregate provider not available for the network: ${networkName}`
      );
  }
}
