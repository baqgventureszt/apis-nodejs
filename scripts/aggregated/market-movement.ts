import {
  aave,
  chainlink,
  deltaNeutralGmxVaults,
  gmxProtocol,
  NetworkName,
  tokens,
} from "@ragetrade/sdk";
import { BigNumber, ethers } from "ethers";
import { formatEther, formatUnits, parseEther } from "ethers/lib/utils";
import { getProviderAggregate } from "../../providers";
import { days, mins, timestampRoundDown } from "../../utils";
import { combine } from "./util/combine";
import { juniorVault } from "./util/events";
import { getLogsInLoop, price } from "./util/helpers";
import { parallelize } from "./util/parallelize";
import { Entry } from "./util/types";

export type MarketMovementEntry = Entry<{
  timestamp: number;

  vaultGlp: number;

  glpPrice: number;
  wethUsdgAmount: number;
  wbtcUsdgAmount: number;
  linkUsdgAmount: number;
  uniUsdgAmount: number;
  totalUsdcAmount: number;
  wethTokenWeight: number;
  wbtcTokenWeight: number;
  linkTokenWeight: number;
  uniTokenWeight: number;
  wethPrice: number;
  wbtcPrice: number;
  linkPrice: number;
  uniPrice: number;
  wethCurrentToken: number;
  wbtcCurrentToken: number;
  linkCurrentToken: number;
  uniCurrentToken: number;

  ethPnl: number;
  btcPnl: number;
  linkPnl: number;
  uniPnl: number;
  pnl: number;
}>;

export interface MarketMovementDailyEntry {
  startTimestamp: number;
  endTimestamp: number;
  ethPnlNet: number;
  btcPnlNet: number;
  linkPnlNet: number;
  uniPnlNet: number;
  pnlNet: number;
}
export interface MarketMovementResult {
  data: MarketMovementEntry[];
  dailyData: MarketMovementDailyEntry[];
  totalEthPnl: number;
  totalBtcPnl: number;
  totalLinkPnl: number;
  totalUniPnl: number;
  totalPnl: number;
}

export async function getMarketMovement(
  networkName: NetworkName
): Promise<MarketMovementResult> {
  const provider = getProviderAggregate(networkName);

  const { dnGmxJuniorVault, dnGmxBatchingManager } =
    deltaNeutralGmxVaults.getContractsSync(networkName, provider);
  const { gmxUnderlyingVault } = gmxProtocol.getContractsSync(
    networkName,
    provider
  );
  const allWhitelistedTokensLength = (
    await gmxUnderlyingVault.allWhitelistedTokensLength()
  ).toNumber();
  const allWhitelistedTokens: string[] = [];
  for (let i = 0; i < allWhitelistedTokensLength; i++) {
    allWhitelistedTokens.push(await gmxUnderlyingVault.allWhitelistedTokens(i));
  }
  const { weth, wbtc, fsGLP } = tokens.getContractsSync(networkName, provider);
  const link = wbtc.attach("0xf97f4df75117a78c1A5a0DBb814Af92458539FB4");
  const uni = wbtc.attach("0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0");

  const { wbtcVariableDebtTokenAddress, wethVariableDebtTokenAddress } =
    aave.getAddresses(networkName);
  const { aUsdc } = aave.getContractsSync(networkName, provider);
  const vdWbtc = aUsdc.attach(wbtcVariableDebtTokenAddress);
  const vdWeth = aUsdc.attach(wethVariableDebtTokenAddress);

  const { ethUsdAggregator } = chainlink.getContractsSync(
    networkName,
    provider
  );

  // LINK / USD: https://arbiscan.io/address/0x86E53CF1B870786351Da77A57575e79CB55812CB
  // UNI / USD: https://arbiscan.io/address/0x9C917083fDb403ab5ADbEC26Ee294f6EcAda2720

  const linkUsdAggregator = ethUsdAggregator.attach(
    "0x86E53CF1B870786351Da77A57575e79CB55812CB"
  );
  const uniUsdAggregator = ethUsdAggregator.attach(
    "0x9C917083fDb403ab5ADbEC26Ee294f6EcAda2720"
  );

  // const startBlock = 52181070;
  // const endBlock = 52419731;

  const startBlock = 44570369;
  const endBlock = await provider.getBlockNumber();
  // const interval = 497; // Math.floor(((endBlock - startBlock) * 3 * mins) / days);

  const _vault = new ethers.Contract(
    gmxUnderlyingVault.address,
    [
      "event IncreaseUsdgAmount(address token, uint256 amount)",
      "event DecreaseUsdgAmount(address token, uint256 amount)",
    ],
    provider
  );

  const data = await parallelize(
    {
      networkName,
      provider,
      getEvents: [
        // juniorVault.deposit,
        // juniorVault.withdraw,
        // juniorVault.rebalanced,
        async () => {
          const logs = await getLogsInLoop(
            _vault,
            _vault.filters.IncreaseUsdgAmount(null, null),
            startBlock,
            endBlock,
            2000
          );
          return logs.filter((l) => l.blockNumber % 200 === 0);
        },
        async () => {
          const logs = await getLogsInLoop(
            _vault,
            _vault.filters.DecreaseUsdgAmount(null, null),
            startBlock,
            endBlock,
            2000
          );
          return logs.filter((l) => l.blockNumber % 200 === 0);
        },
      ],
      //   () => {
      //     const events = [];
      //     for (let i = startBlock; i <= endBlock; i += interval) {
      //       events.push({
      //         blockNumber: i,
      //       });
      //     }
      //     return events as ethers.Event[];
      //   },
      ignoreMoreEventsInSameBlock: true,
    },
    async (_i, blockNumber) => {
      const block = await provider.getBlock(blockNumber);
      const usdgAmounts = await Promise.all(
        allWhitelistedTokens.map((token) =>
          gmxUnderlyingVault.usdgAmounts(token, { blockTag: blockNumber })
        )
      ); // 18
      // const usdgAmounts: number[] = [
      //   await gmxUnderlyingVault.usdgAmounts(weth.address, {
      //     blockTag: blockNumber,
      //   }),
      //   await gmxUnderlyingVault.usdgAmounts(wbtc.address, {
      //     blockTag: blockNumber,
      //   }),
      //   await gmxUnderlyingVault.usdgAmounts(link.address, {
      //     blockTag: blockNumber,
      //   }),
      //   await gmxUnderlyingVault.usdgAmounts(uni.address, {
      //     blockTag: blockNumber,
      //   }),
      // ].map((x) => Number(formatUnits(x, 18)));

      const wethUsdgAmount = Number(
        formatEther(
          await gmxUnderlyingVault.usdgAmounts(weth.address, {
            blockTag: blockNumber,
          })
        )
      );
      const wbtcUsdgAmount = Number(
        formatEther(
          await gmxUnderlyingVault.usdgAmounts(wbtc.address, {
            blockTag: blockNumber,
          })
        )
      );
      const linkUsdgAmount = Number(
        formatEther(
          await gmxUnderlyingVault.usdgAmounts(link.address, {
            blockTag: blockNumber,
          })
        )
      );
      const uniUsdgAmount = Number(
        formatEther(
          await gmxUnderlyingVault.usdgAmounts(uni.address, {
            blockTag: blockNumber,
          })
        )
      );

      const totalUsdcAmount = Number(
        formatEther(usdgAmounts.reduce((a, b) => a.add(b), BigNumber.from(0)))
      );

      const wethTokenWeight = wethUsdgAmount / totalUsdcAmount;
      const wbtcTokenWeight = wbtcUsdgAmount / totalUsdcAmount;
      const linkTokenWeight = linkUsdgAmount / totalUsdcAmount;
      const uniTokenWeight = uniUsdgAmount / totalUsdcAmount;

      // const vdWbtc_balanceOf_dnGmxJuniorVault = await vdWbtc.balanceOf(
      //   dnGmxJuniorVault.address,
      //   { blockTag: blockNumber }
      // );
      // const vdWeth_balanceOf_dnGmxJuniorVault = await vdWeth.balanceOf(
      //   dnGmxJuniorVault.address,
      //   { blockTag: blockNumber }
      // );

      const glpPrice = Number(
        formatEther(
          await dnGmxJuniorVault.getPrice(false, {
            blockTag: blockNumber,
          })
        )
      );

      const wethPrice = await price(weth.address, blockNumber, networkName);
      const wbtcPrice = await price(wbtc.address, blockNumber, networkName);
      const linkPrice = Number(
        formatUnits(
          (
            await linkUsdAggregator.latestRoundData({
              blockTag: blockNumber,
            })
          ).answer,
          8
        )
      );
      const uniPrice = Number(
        formatUnits(
          (
            await uniUsdAggregator.latestRoundData({
              blockTag: blockNumber,
            })
          ).answer,
          8
        )
      );
      const fsGlp_balanceOf_juniorVault = Number(
        formatEther(
          await fsGLP.balanceOf(dnGmxJuniorVault.address, {
            blockTag: blockNumber,
          })
        )
      );
      const fsGlp_balanceOf_batchingManager = Number(
        formatEther(
          await dnGmxBatchingManager.dnGmxJuniorVaultGlpBalance({
            blockTag: blockNumber,
          })
        )
      );
      // const fsGlp_totalSuply = Number(
      //   formatEther(
      //     await fsGLP.totalSupply({
      //       blockTag: blockNumber,
      //     })
      //   )
      // );

      const vaultGlp =
        fsGlp_balanceOf_juniorVault + fsGlp_balanceOf_batchingManager;

      const wethCurrentToken =
        (wethTokenWeight * vaultGlp * glpPrice) / wethPrice;
      const wbtcCurrentToken =
        (wbtcTokenWeight * vaultGlp * glpPrice) / wbtcPrice;
      const linkCurrentToken =
        (linkTokenWeight * vaultGlp * glpPrice) / linkPrice;
      const uniCurrentToken = (uniTokenWeight * vaultGlp * glpPrice) / uniPrice;

      return {
        blockNumber: blockNumber,
        timestamp: block.timestamp,
        // fsGlp_balanceOf_juniorVault,
        // fsGlp_balanceOf_batchingManager,
        // fsGlp_totalSuply,
        vaultGlp,
        glpPrice,
        wethUsdgAmount,
        wbtcUsdgAmount,
        linkUsdgAmount,
        uniUsdgAmount,
        totalUsdcAmount,
        wethTokenWeight,
        wbtcTokenWeight,
        linkTokenWeight,
        uniTokenWeight,
        wethPrice,
        wbtcPrice,
        linkPrice,
        uniPrice,
        wethCurrentToken,
        wbtcCurrentToken,
        linkCurrentToken,
        uniCurrentToken,
      };
    }
  );

  const extraData: Entry<{
    ethPnl: number;
    btcPnl: number;
    uniPnl: number;
    linkPnl: number;
    pnl: number;
  }>[] = [];

  let last;
  for (const current of data) {
    if (last) {
      const ethPnl =
        last.wethCurrentToken * (current.wethPrice - last.wethPrice);
      const btcPnl =
        last.wbtcCurrentToken * (current.wbtcPrice - last.wbtcPrice);
      const uniPnl = last.uniCurrentToken * (current.uniPrice - last.uniPrice);
      const linkPnl =
        last.linkCurrentToken * (current.linkPrice - last.linkPrice);

      extraData.push({
        blockNumber: current.blockNumber,
        ethPnl,
        btcPnl,
        uniPnl,
        linkPnl,
        pnl: ethPnl + btcPnl + uniPnl + linkPnl,
      });
    } else {
      extraData.push({
        blockNumber: current.blockNumber,
        ethPnl: 0,
        btcPnl: 0,
        uniPnl: 0,
        linkPnl: 0,
        pnl: 0,
      });
    }
    last = current;
  }

  const combinedData = combine(data, extraData, (a, b) => ({
    ...a,
    ...b,
  }));

  return {
    data: combinedData,
    dailyData: combinedData.reduce(
      (acc: MarketMovementDailyEntry[], cur: MarketMovementEntry) => {
        let lastEntry = acc[acc.length - 1];
        if (lastEntry && cur.timestamp <= lastEntry.endTimestamp) {
          lastEntry.btcPnlNet += cur.btcPnl;
          lastEntry.ethPnlNet += cur.ethPnl;
          lastEntry.uniPnlNet += cur.uniPnl;
          lastEntry.linkPnlNet += cur.linkPnl;
          lastEntry.pnlNet += cur.pnl;
        } else {
          while (
            lastEntry &&
            lastEntry.startTimestamp + 1 * days <
              timestampRoundDown(cur.timestamp)
          ) {
            acc.push({
              startTimestamp: lastEntry.startTimestamp + 1 * days,
              endTimestamp: lastEntry.startTimestamp + 2 * days - 1,
              btcPnlNet: 0,
              ethPnlNet: 0,
              uniPnlNet: 0,
              linkPnlNet: 0,
              pnlNet: 0,
            });
            lastEntry = acc[acc.length - 1];
          }
          acc.push({
            startTimestamp: timestampRoundDown(cur.timestamp),
            endTimestamp: timestampRoundDown(cur.timestamp) + 1 * days - 1,
            btcPnlNet: cur.btcPnl,
            ethPnlNet: cur.ethPnl,
            uniPnlNet: cur.uniPnl,
            linkPnlNet: cur.linkPnl,
            pnlNet: cur.pnl,
          });
        }
        return acc;
      },
      []
    ),
    totalBtcPnl: combinedData.reduce((acc, cur) => acc + cur.btcPnl, 0),
    totalEthPnl: combinedData.reduce((acc, cur) => acc + cur.ethPnl, 0),
    totalUniPnl: combinedData.reduce((acc, cur) => acc + cur.uniPnl, 0),
    totalLinkPnl: combinedData.reduce((acc, cur) => acc + cur.linkPnl, 0),
    totalPnl: combinedData.reduce((acc, cur) => acc + cur.pnl, 0),
  };
}