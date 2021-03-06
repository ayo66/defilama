import useSWR from 'swr'
import {
  CHART_API,
  PROTOCOLS_API,
  PROTOCOL_API,
  NFT_COLLECTIONS_API,
  NFT_COLLECTION_API,
  NFT_CHART_API,
  NFT_CHAINS_API,
  NFT_MARKETPLACES_API,
  NFT_SEARCH_API,
  CONFIG_API,
  HOURLY_PROTOCOL_API,
} from '../constants/index'
import { getPercentChange, getPrevTvlFromChart, standardizeProtocolName } from 'utils'

interface IProtocol {
  name: string
  symbol: string
  chains: string[]
  chainTvls: {
    [key: string]: {
      tvl: number
      tvlPrevDay: number
      tvlPrevWeek: number
      tvlPrevMonth: number
    }
  }
  tvl: {
    date: number
    totalLiquidityUSD: number
  }[]
}

interface IChainGeckoId {
  geckoId: string
  symbol: string
  cmcId: string
  categories: string[]
}

interface IChainData {
  [key: string]: [number, number][]
}

interface IStackedDataset {
  [key: number]: {
    [key: string]: {
      [key: string]: number
    }
  }
}

export function getProtocolNames(protocols) {
  return protocols.map((p) => ({ name: p.name, symbol: p.symbol }))
}

export const basicPropertiesToKeep = [
  'tvl',
  'name',
  'symbol',
  'chains',
  'change_1d',
  'change_7d',
  'change_1m',
  'tvlPrevDay',
  'tvlPrevWeek',
  'tvlPrevMonth',
  'mcap',
]
export function keepNeededProperties(protocol: any, propertiesToKeep: string[] = basicPropertiesToKeep) {
  return propertiesToKeep.reduce((obj, prop) => {
    if (protocol[prop] !== undefined) {
      obj[prop] = protocol[prop]
    }
    return obj
  }, {})
}

const formatProtocolsData = ({
  chain = '',
  category = '',
  protocols = [],
  protocolProps = [...basicPropertiesToKeep, 'extraTvl'],
}) => {
  let filteredProtocols = [...protocols]

  if (chain) {
    filteredProtocols = filteredProtocols.filter(({ chains = [] }) => chains.includes(chain))
  }

  if (category) {
    filteredProtocols = filteredProtocols.filter(
      ({ category: protocolCategory = '' }) =>
        category.toLowerCase() === (protocolCategory ? protocolCategory.toLowerCase() : '')
    )
  }

  filteredProtocols = filteredProtocols.map((protocol) => {
    if (chain) {
      protocol.tvl = protocol.chainTvls[chain]?.tvl ?? 0
      protocol.tvlPrevDay = protocol.chainTvls[chain]?.tvlPrevDay ?? null
      protocol.tvlPrevWeek = protocol.chainTvls[chain]?.tvlPrevWeek ?? null
      protocol.tvlPrevMonth = protocol.chainTvls[chain]?.tvlPrevMonth ?? null
    }
    protocol.extraTvl = {}
    protocol.change_1d = getPercentChange(protocol.tvl, protocol.tvlPrevDay)
    protocol.change_7d = getPercentChange(protocol.tvl, protocol.tvlPrevWeek)
    protocol.change_1m = getPercentChange(protocol.tvl, protocol.tvlPrevMonth)

    Object.entries(protocol.chainTvls).forEach(([sectionName, sectionTvl]) => {
      if (chain) {
        if (sectionName.startsWith(`${chain}-`)) {
          const sectionToAdd = sectionName.split('-')[1]
          protocol.extraTvl[sectionToAdd] = sectionTvl
        }
      } else {
        const firstChar = sectionName[0]
        if (firstChar === firstChar.toLowerCase() || sectionName === 'Offers' || sectionName === 'Treasury') {
          protocol.extraTvl[sectionName] = sectionTvl
        }
      }
    })
    return keepNeededProperties(protocol, protocolProps)
  })

  if (chain) {
    filteredProtocols = filteredProtocols.sort((a, b) => b.tvl - a.tvl)
  }

  return filteredProtocols
}

export async function getProtocolsPageData(category, chain) {
  const { protocols, chains } = await getProtocols()

  let filteredProtocols = formatProtocolsData({ category, protocols })

  const chainsSet = new Set()

  filteredProtocols.forEach(({ chains }) => {
    chains.forEach((chain) => chainsSet.add(chain))
  })

  // filter protocols by chain after we have data of all the chains of protocols in a category
  if (chain) {
    filteredProtocols = filteredProtocols.filter(({ chains = [] }) => chains.includes(chain))
  }

  return {
    filteredProtocols,
    chain: chain ?? 'All',
    category,
    chains: chains.filter((chain) => chainsSet.has(chain)),
  }
}

export async function getSimpleProtocolsPageData(propsToKeep) {
  const { protocols, chains } = await getProtocols()
  const filteredProtocols = formatProtocolsData({ protocols, protocolProps: propsToKeep })
  return { protocols: filteredProtocols, chains }
}

export async function getChainPageData(chain) {
  let chartData, protocols, chains
  try {
    ;[chartData, { protocols, chains }] = await Promise.all(
      [CHART_API + (chain ? '/' + chain : ''), PROTOCOLS_API].map((url) => fetch(url).then((r) => r.json()))
    )
  } catch (e) {
    return {
      notFound: true,
    }
  }

  const { tvl = [], staking = [], borrowed = [], pool2 = [], offers = [], treasury = [] } = chartData || {}

  const filteredProtocols = formatProtocolsData({ chain, protocols })

  const extraVolumesCharts = {
    staking: staking.map(([date, totalLiquidityUSD]) => [date, Math.trunc(totalLiquidityUSD)]),
    borrowed: borrowed.map(([date, totalLiquidityUSD]) => [date, Math.trunc(totalLiquidityUSD)]),
    pool2: pool2.map(([date, totalLiquidityUSD]) => [date, Math.trunc(totalLiquidityUSD)]),
    offers: offers.map(([date, totalLiquidityUSD]) => [date, Math.trunc(totalLiquidityUSD)]),
    treasury: treasury.map(([date, totalLiquidityUSD]) => [date, Math.trunc(totalLiquidityUSD)]),
  }

  return {
    props: {
      ...(chain && { chain }),
      chainsSet: chains,
      filteredProtocols,
      chart: tvl.map(([date, totalLiquidityUSD]) => [date, Math.trunc(totalLiquidityUSD)]),
      extraVolumesCharts,
    },
  }
}

export const getProtocols = () =>
  fetch(PROTOCOLS_API)
    .then((r) => r.json())
    .then(({ protocols, chains, protocolCategories }) => ({
      protocolsDict: protocols.reduce((acc, curr) => {
        acc[standardizeProtocolName(curr.name)] = curr
        return acc
      }, {}),
      protocols,
      chains,
      categories: protocolCategories,
    }))

export const getProtocol = async (protocolName: string) => {
  try {
    const data: IProtocol = await fetch(`${PROTOCOL_API}/${protocolName}`).then((r) => r.json())
    const tvl = data?.tvl ?? []
    if (tvl.length < 7) {
      const hourlyData = await fetch(`${HOURLY_PROTOCOL_API}/${protocolName}`).then((r) => r.json())
      return { ...hourlyData, isHourlyChart: true }
    } else return data
  } catch (e) {
    console.log(e)
  }
}

export const fuseProtocolData = (protocolData, protocol) => {
  const historicalChainTvls = protocolData?.chainTvls ?? {}
  const chainTvls = protocolData.currentChainTvls ?? {}
  const tvl = protocolData?.tvl ?? []

  return {
    ...protocolData,
    tvl: tvl.length > 0 ? tvl[tvl.length - 1]?.totalLiquidityUSD : 0,
    tvlList: tvl.filter((item) => item.date).map(({ date, totalLiquidityUSD }) => [date, totalLiquidityUSD]),
    historicalChainTvls,
    chainTvls,
  }
}

export const getChainsPageData = async (category: string) => {
    const [res, { chainCoingeckoIds }] = await Promise.all(
      [PROTOCOLS_API, CONFIG_API].map((apiEndpoint) => fetch(apiEndpoint).then((r) => r.json()))
    )

    let categories = []
    for (const chain in chainCoingeckoIds) {
      chainCoingeckoIds[chain].categories?.forEach((category) => {
        if (!categories.includes(category)) {
          categories.push(category)
        }
      })
    }

    const categoryExists = categories.includes(category) || category === 'All' || category === 'Non-EVM'

    if (!categoryExists) {
      return {
        notFound: true,
      }
    } else {
      categories = [
        { label: 'All', to: '/chains' },
        { label: 'Non-EVM', to: '/chains/Non-EVM' },
      ].concat(categories.map((category) => ({ label: category, to: `/chains/${category}` })))
    }

    const chainsUnique: string[] = res.chains.filter((t: string) => {
      if (t !== 'Syscoin') {
        const chainCategories = chainCoingeckoIds[t]?.categories ?? []
        if (category === 'All') {
          return true
        } else if (category === 'Non-EVM') {
          return !chainCategories.includes('EVM')
        } else {
          return chainCategories.includes(category)
        }
      }
    })

    let chainsGroupbyParent = {}
    chainsUnique.forEach((chain) => {
      const parent = chainCoingeckoIds[chain].parent
      if (parent) {
        if (!chainsGroupbyParent[parent]) {
          chainsGroupbyParent[parent] = {}
        }
        chainsGroupbyParent[parent][chain] = {}
      }
    })

    const chainsData: IChainData[] = await Promise.all(
      chainsUnique.map((elem: string) => fetch(`${CHART_API}/${elem}`).then((resp) => resp.json()))
    )

    const chainMcaps = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(chainCoingeckoIds)
        .map((v: IChainGeckoId) => v.geckoId)
        .join(',')}&vs_currencies=usd&include_market_cap=true`
    ).then((res) => res.json())
    const numProtocolsPerChain = {}
    const extraPropPerChain = {}

    res.protocols.forEach((protocol: IProtocol) => {
      protocol.chains.forEach((chain) => {
        numProtocolsPerChain[chain] = (numProtocolsPerChain[chain] || 0) + 1
      })
      Object.entries(protocol.chainTvls).forEach(([propKey, propValue]) => {
        if (propKey.includes('-')) {
          const prop = propKey.split('-')[1].toLowerCase()
          const chain = propKey.split('-')[0]
          if (extraPropPerChain[chain] === undefined) {
            extraPropPerChain[chain] = {}
          }
          extraPropPerChain[chain][prop] = {
            tvl: (propValue.tvl || 0) + (extraPropPerChain[chain][prop]?.tvl ?? 0),
            tvlPrevDay: (propValue.tvlPrevDay || 0) + (extraPropPerChain[chain][prop]?.tvlPrevDay ?? 0),
            tvlPrevWeek: (propValue.tvlPrevWeek || 0) + (extraPropPerChain[chain][prop]?.tvlPrevWeek ?? 0),
            tvlPrevMonth: (propValue.tvlPrevMonth || 0) + (extraPropPerChain[chain][prop]?.tvlPrevMonth ?? 0),
          }
        }
      })
    })

    const tvlData = chainsData.map((d) => d.tvl)
    const chainTvls = chainsUnique
      .map((chainName, i) => {
        const tvl = getPrevTvlFromChart(tvlData[i], 0)
        const tvlPrevDay = getPrevTvlFromChart(tvlData[i], 1)
        const tvlPrevWeek = getPrevTvlFromChart(tvlData[i], 7)
        const tvlPrevMonth = getPrevTvlFromChart(tvlData[i], 30)
        const mcap = chainMcaps[chainCoingeckoIds[chainName]?.geckoId]?.usd_market_cap
        return {
          tvl,
          tvlPrevDay,
          tvlPrevWeek,
          tvlPrevMonth,
          mcap: mcap || null,
          name: chainName,
          symbol: chainCoingeckoIds[chainName]?.symbol ?? '-',
          protocols: numProtocolsPerChain[chainName],
          extraTvl: extraPropPerChain[chainName] || {},
          change_1d: getPercentChange(tvl, tvlPrevDay),
          change_7d: getPercentChange(tvl, tvlPrevWeek),
          change_1m: getPercentChange(tvl, tvlPrevMonth),
        }
      })
      .sort((a, b) => b.tvl - a.tvl)

    const stackedDataset = Object.entries(
      chainsData.reduce((total: IStackedDataset, chains, i) => {
        const chainName = chainsUnique[i]
        Object.entries(chains).forEach(([tvlType, values]) => {
          values.forEach((value) => {
            if (value[0] < 1596248105) return
            if (total[value[0]] === undefined) {
              total[value[0]] = {}
            }
            const b = total[value[0]][chainName]
            total[value[0]][chainName] = { ...b, [tvlType]: value[1] }
          })
        })
        return total
      }, {})
    )

    return {
      props: {
        chainsUnique,
        chainTvls,
        stackedDataset,
        category,
        categories,
        chainsGroupbyParent,
      },
    }
}

export const getNFTStatistics = (chart) => {
  const { totalVolume, totalVolumeUSD } = (chart.length &&
    chart.reduce((volumes, data) => {
      if (volumes.totalVolumeUSD >= 0 && volumes.totalVolume >= 0) {
        volumes.totalVolumeUSD += data.volumeUSD ?? 0
        volumes.totalVolume += data.volume ?? 0
      } else {
        volumes.totalVolumeUSD = data.volumeUSD ?? 0
        volumes.totalVolume = data.volume ?? 0
      }
      return volumes
    }, {})) || {
    totalVolume: 0,
    totalVolumeUSD: 0,
  }

  const dailyVolume = chart.length ? chart[chart.length - 1]?.volume || 0 : 0
  const dailyVolumeUSD = chart.length ? chart[chart.length - 1]?.volumeUSD || 0 : 0
  const dailyChange = chart.length
    ? ((dailyVolumeUSD - chart[chart.length - 2]?.volumeUSD) / chart[chart.length - 2]?.volumeUSD) * 100
    : 0

  return {
    totalVolumeUSD,
    totalVolume,
    dailyVolumeUSD,
    dailyVolume,
    dailyChange,
  }
}

export const getNFTData = async () => {
  try {
    const chart = await fetch(NFT_CHART_API).then((r) => r.json())
    const { data: collections } = await fetch(NFT_COLLECTIONS_API).then((r) => r.json())
    const statistics = getNFTStatistics(chart)

    return {
      chart,
      collections,
      statistics,
    }
  } catch (e) {
    console.log(e)
    return {
      chart: [],
      collections: [],
      statistics: {},
    }
  }
}

export const getNFTCollections = async (chain: string) => {
  try {
    const { data: collections } = await fetch(NFT_COLLECTIONS_API).then((r) => r.json())
    return collections
  } catch (e) {
    console.log(e)
  }
}

export const getNFTCollectionsByChain = async (chain: string) => {
  try {
    const { data: collections } = await fetch(`${NFT_COLLECTIONS_API}/chain/${chain}`).then((r) => r.json())
    return collections
  } catch (e) {
    console.log(e)
  }
}

export const getNFTCollectionsByMarketplace = async (marketplace: string) => {
  try {
    const { data: collections } = await fetch(`${NFT_COLLECTIONS_API}/marketplace/${marketplace}`).then((r) => r.json())
    return collections
  } catch (e) {
    console.log(e)
  }
}

export const getNFTCollection = async (slug) => {
  try {
    const data = await fetch(`${NFT_COLLECTION_API}/${slug}`).then((r) => r.json())
    return data.find((data) => data.SK === 'overview')
  } catch (e) {
    console.log(e)
  }
}

export const getNFTChainChartData = async (chain) => {
  try {
    return fetch(`${NFT_CHART_API}/chain/${chain}`).then((r) => r.json())
  } catch (e) {
    console.log(e)
  }
}

export const getNFTMarketplaceChartData = async (marketplace) => {
  try {
    return fetch(`${NFT_CHART_API}/marketplace/${marketplace}`).then((r) => r.json())
  } catch (e) {
    console.log(e)
  }
}

export const getNFTCollectionChartData = async (slug) => {
  try {
    return fetch(`${NFT_CHART_API}/collection/${slug}`).then((r) => r.json())
  } catch (e) {
    console.log(e)
  }
}

export const getNFTChainsData = async () => {
  try {
    return fetch(NFT_CHAINS_API).then((r) => r.json())
  } catch (e) {
    console.log(e)
  }
}

export const getNFTMarketplacesData = async () => {
  try {
    return fetch(NFT_MARKETPLACES_API).then((r) => r.json())
  } catch (e) {
    console.log(e)
  }
}

export const getNFTSearchResults = async (query: string) => {
  try {
    if (query) {
      const { hits }: { hits: any } = await fetch(`${NFT_SEARCH_API}?query=${query}`).then((r) => r.json())
      return hits.map((hit) => hit._source)
    }
    return []
  } catch (e) {
    console.log(e)
  }
}

// Client Side

const fetcher = (input: RequestInfo, init?: RequestInit) => fetch(input, init).then((res) => res.json())

export const useFetchProtocol = (protocolName) => {
  const { data, error } = useSWR(protocolName ? `${PROTOCOL_API}/${protocolName}` : null, fetcher)
  return { data, error, loading: protocolName && !data && !error }
}

export const useGeckoProtocol = (gecko_id, defaultCurrency = 'usd') => {
  const { data, error } = useSWR(
    gecko_id ? `https://api.coingecko.com/api/v3/simple/price?ids=${gecko_id}&vs_currencies=${defaultCurrency}` : null,
    fetcher
  )
  return { data, error, loading: gecko_id && !data && !error }
}

export const useDenominationPriceHistory = (gecko_id: string, utcStartTime: string) => {
  let url = `https://api.coingecko.com/api/v3/coins/${gecko_id}/market_chart/range?vs_currency=usd&from=${utcStartTime}&to=${Math.floor(
    Date.now() / 1000
  )}`

  const { data, error } = useSWR(gecko_id ? url : null, fetcher)

  return { data, error, loading: gecko_id && !data && !error }
}

//:00 -> adapters start running, they take up to 15mins
//:20 -> storeProtocols starts running, sets cache expiry to :21 of next hour
//:22 -> we rebuild all pages
function next22Minutedate() {
  const dt = new Date()
  dt.setHours(dt.getHours() + 1)
  dt.setMinutes(22)
  return dt
}

export function revalidate() {
  const current = Date.now()
  return Math.ceil((next22Minutedate().getTime() - current) / 1000)
}
