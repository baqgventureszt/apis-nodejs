import { fetchJson, formatEther, formatUnits } from "ethers/lib/utils";

import {
  aave,
  deltaNeutralGmxVaults,
  formatUsdc,
  NetworkName,
  ResultWithMetadata,
  tokens,
} from "@ragetrade/sdk";

import { getProviderAggregate } from "../../providers";
import { combine } from "./util/combine";
import { parallelize } from "./util/parallelize";
import { Entry } from "./util/types";
import { price } from "./util/helpers";
import { depositWithdrawRebalance } from "./util/events/deposit-withdraw-rebalance";
import { GlobalTotalSharesResult } from "./total-shares";
import { timestampRoundDown, days } from "../../utils";

export type GlobalAaveLendsEntry = Entry<{
  timestamp: number;
  aUsdcInterestJunior: number;
  aUsdcInterestSenior: number;
}>;

export interface GlobalAaveLendsDailyEntry {
  startTimestamp: number;
  endTimestamp: number;
  aUsdcInterestJuniorNet: number;
  aUsdcInterestSeniorNet: number;
}

export interface GlobalAaveLendsResult {
  data: GlobalAaveLendsEntry[];
  dailyData: GlobalAaveLendsDailyEntry[];
}

export async function getAaveLends(
  networkName: NetworkName
): Promise<GlobalAaveLendsResult> {
  const provider = getProviderAggregate(networkName);

  const { weth, wbtc } = tokens.getContractsSync(networkName, provider);
  const { aUsdc } = aave.getContractsSync(networkName, provider);
  const { dnGmxJuniorVault, dnGmxSeniorVault } =
    deltaNeutralGmxVaults.getContractsSync(networkName, provider);

  const { wbtcVariableDebtTokenAddress, wethVariableDebtTokenAddress } =
    aave.getAddresses(networkName);
  const vdWbtc = aUsdc.attach(wbtcVariableDebtTokenAddress);
  const vdWeth = aUsdc.attach(wethVariableDebtTokenAddress);

  const totalSharesData: ResultWithMetadata<GlobalTotalSharesResult> =
    await fetchJson({
      url: `http://localhost:3000/data/aggregated/get-total-shares?networkName=${networkName}`,
      timeout: 1_000_000_000, // huge number
    });

  const data = await parallelize(
    networkName,
    provider,
    depositWithdrawRebalance,
    async (_i, blockNumber, eventName, transactionHash, logIndex) => {
      const aUsdcJuniorBefore = Number(
        formatUsdc(
          await aUsdc.balanceOf(dnGmxJuniorVault.address, {
            blockTag: blockNumber - 1,
          })
        )
      );
      const aUsdcJuniorAfter = Number(
        formatUsdc(
          await aUsdc.balanceOf(dnGmxJuniorVault.address, {
            blockTag: blockNumber,
          })
        )
      );

      const aUsdcSeniorBefore = Number(
        formatUsdc(
          await aUsdc.balanceOf(dnGmxSeniorVault.address, {
            blockTag: blockNumber - 1,
          })
        )
      );
      const aUsdcSeniorAfter = Number(
        formatUsdc(
          await aUsdc.balanceOf(dnGmxSeniorVault.address, {
            blockTag: blockNumber,
          })
        )
      );

      return {
        blockNumber,
        eventName,
        transactionHash,
        logIndex,
        aUsdcJuniorBefore,
        aUsdcJuniorAfter,
        aUsdcSeniorBefore,
        aUsdcSeniorAfter,
      };
    }
  );

  const dataWithTimestamp = combine(
    data,
    totalSharesData.result.data,
    (a, b) => ({
      ...a,
      timestamp: b.timestamp,
    })
  );

  const extraData: Entry<{
    aUsdcInterestJunior: number;
    aUsdcInterestSenior: number;
  }>[] = [];

  let last;
  for (const current of dataWithTimestamp) {
    if (last) {
      extraData.push({
        blockNumber: current.blockNumber,
        eventName: current.eventName,
        transactionHash: current.transactionHash,
        logIndex: current.logIndex,
        aUsdcInterestJunior: current.aUsdcJuniorBefore - last.aUsdcJuniorAfter,
        aUsdcInterestSenior: current.aUsdcSeniorBefore - last.aUsdcSeniorAfter,
      });
    } else {
      extraData.push({
        blockNumber: current.blockNumber,
        eventName: current.eventName,
        transactionHash: current.transactionHash,
        logIndex: current.logIndex,
        aUsdcInterestJunior: 0,
        aUsdcInterestSenior: 0,
      });
    }
    last = current;
  }

  const combinedData = combine(dataWithTimestamp, extraData, (a, b) => ({
    ...a,
    ...b,
  }));
  return {
    data: combinedData,
    dailyData: combinedData.reduce(
      (acc: GlobalAaveLendsDailyEntry[], cur: GlobalAaveLendsEntry) => {
        const lastEntry = acc[acc.length - 1];
        if (lastEntry && cur.timestamp <= lastEntry.endTimestamp) {
          lastEntry.aUsdcInterestJuniorNet += cur.aUsdcInterestJunior;
          lastEntry.aUsdcInterestSeniorNet += cur.aUsdcInterestSenior;
        } else {
          acc.push({
            startTimestamp: timestampRoundDown(cur.timestamp),
            endTimestamp: timestampRoundDown(cur.timestamp) + 1 * days - 1,
            aUsdcInterestJuniorNet: cur.aUsdcInterestJunior,
            aUsdcInterestSeniorNet: cur.aUsdcInterestSenior,
          });
        }
        return acc;
      },
      []
    ),
  };
}