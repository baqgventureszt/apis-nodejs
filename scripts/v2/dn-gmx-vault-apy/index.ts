import { getTraderPnl } from "./trader-pnl";
import { getSupplyApy } from "./supply-rate";
import { getBorrowApy } from "./borrow-rate";
import { getEthRewards } from "./eth-rewards";

import { NetworkName } from "@ragetrade/sdk";

export const getDnGmxApyBreakdown = async (networkName: NetworkName) => {
  const traderPnl = await getTraderPnl();

  const supplyApy = await getSupplyApy(networkName);
  const borrowApy = await getBorrowApy(networkName);

  const ethRewards = await getEthRewards(networkName);

  const seniorVault = {
    aaveSupplyApy: supplyApy,
    glpRewardsPct: ethRewards[1],
  };

  const juniorVault = {
    btcBorrowApy: borrowApy[0],
    ethBorrowApy: borrowApy[1],
    glpTraderPnl: traderPnl,
    glpRewardsPct: ethRewards[0],
  };

  return { seniorVault, juniorVault };
};