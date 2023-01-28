import type { NetworkName } from '@ragetrade/sdk'
import { deltaNeutralGmxVaults, tokens } from '@ragetrade/sdk'
import type { DepositTokenEvent } from '@ragetrade/sdk/dist/typechain/delta-neutral-gmx-vaults/contracts/vaults/DnGmxBatchingManager'
import type { ethers } from 'ethers'

import { ErrorWithStatusCode } from '../../../../../utils'
import { getLogsInLoop } from '../../helpers'
import { GET_LOGS_BLOCK_INTERVAL } from '../common'

export async function depositToken(
  networkName: NetworkName,
  provider: ethers.providers.Provider,
  startBlock?: number
): Promise<DepositTokenEvent[]> {
  const { dnGmxBatchingManager } = deltaNeutralGmxVaults.getContractsSync(
    networkName,
    provider
  )
  const { weth } = tokens.getContractsSync(networkName, provider)
  const { DnGmxBatchingManagerDeployment } =
    deltaNeutralGmxVaults.getDeployments(networkName)

  if (!startBlock) startBlock = DnGmxBatchingManagerDeployment.receipt?.blockNumber
  const endBlock = await provider.getBlockNumber()

  if (!startBlock) {
    throw new ErrorWithStatusCode('Start block is not defined', 500)
  }

  const logs = await getLogsInLoop(
    dnGmxBatchingManager,
    dnGmxBatchingManager.filters.DepositToken(null, weth.address, null, null, null),
    startBlock,
    endBlock,
    GET_LOGS_BLOCK_INTERVAL
  )

  return logs as DepositTokenEvent[]
}
