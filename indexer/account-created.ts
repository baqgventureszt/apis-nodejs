import { ClearingHouse__factory, core } from '@ragetrade/sdk'

import { getRedisClient } from '../redis-utils/get-client'
import { RedisStore } from '../store/redis-store'
import { BaseIndexer } from './base-indexer'

import type { AccountCreatedEvent } from '@ragetrade/sdk/dist/typechain/core/contracts/interfaces/IClearingHouse'
import type { ethers } from 'ethers'
import type { BaseStore } from '../store/base-store'
const iface = ClearingHouse__factory.createInterface()

export class AccountCreatedIndexer extends BaseIndexer<number[]> {
  _keyPrepend = 'account-created-indexer'

  getStore(): BaseStore<number[]> {
    return new RedisStore<number[]>({
      client: getRedisClient(),
      updateCache: false
    })
  }

  async getFilter(provider: ethers.providers.Provider): Promise<ethers.EventFilter> {
    const { clearingHouse } = await core.getContracts(provider)
    return clearingHouse.filters.AccountCreated()
  }

  async forEachLog(log: ethers.providers.Log) {
    console.log('for each')
    const parsed = iface.parseLog(log) as unknown as AccountCreatedEvent
    const accountIds = (await this.get(parsed.args.ownerAddress)) ?? []
    accountIds.push(parsed.args.accountId.toNumber())
    await this.set(parsed.args.ownerAddress, accountIds)
  }
}
