import { GraphQLClient } from 'graphql-request';

export const getGalaxyApi = options =>
  new GraphQLClient(options.galaxyUrl, {
    headers: {
      'galaxy-api-key': options.apiKey,
    },
  });

const addMetaDataToMetric = ({ isApp, app } = {}) => {
  return metric => {
    return {
      ...metric,
      // this timestamp is in seconds and not milliseconds
      // eslint-disable-next-line no-bitwise
      timestamp: (+`${metric.timestamp}000` / 1000) | 0,
      cpuPercentage: (metric.cpu / metric.cpuCap) * 100,
      memoryPercentage: (metric.memory / metric.memoryCap) * 100,
      ...(isApp
        ? {
            connectionsByContainer: metric.connections / app.runningCount,
          }
        : {}),
    };
  };
};

const removeAdditional = (arr, limit) => {
  // sometimes we get -1 metrics but when we don't we eliminate
  const maxElements = limit - 1;
  if (arr.length <= maxElements) {
    return arr;
  }
  return arr.slice(0, maxElements);
};

export const scaleApp = async ({ api, appId, containerCount }) => {
  return api.request(
    `
    mutation SetContainerCountForApp($appId:String!, $containerCount:Int!)
    {
      setContainerCountForApp(appId:$appId, containerCount:$containerCount) {
        status
      }
    }
    `,
    { appId, containerCount }
  );
};

export const getMetrics = async ({ api, options }) => {
  // sometimes we get -1 metrics
  const limit = (options.variables.limit || 5) + 1;
  const data = await api.request(
    `
    query getApp($hostname: String!, $seriesName: String!, $limit: Int!){
      app(hostname: $hostname){
        _id
        hostname
        status
        containerCount
        containerType {
          _id
          name
        }
        metrics(seriesName: $seriesName, limit: $limit){
          _id
          memory
          memoryCap
          cpu
          cpuCap
          connections
          timestamp
        }
        containers {
          _id
          status
          up
          metrics(seriesName: $seriesName, limit: $limit){
            _id
            memory
            memoryCap
            cpu
            cpuCap
            connections
            timestamp
          }
        }
      }
    }
    `,
    { ...options.variables, limit }
  );

  const app = {
    ...data.app,
    containers: data.app.containers.map(container => {
      let containerMetrics = removeAdditional(container.metrics, limit).map(
        addMetaDataToMetric()
      );
      return {
        ...container,
        metrics: containerMetrics,
        lastMetric:
          containerMetrics && containerMetrics.length && containerMetrics[0],
      };
    }),
    unavailableCount: data.app.containers.filter(({ up }) => !up).length,
    runningCount: data.app.containers.filter(({ up }) => !!up).length,
  };

  const appMetrics = removeAdditional(data.app.metrics, limit).map(
    addMetaDataToMetric({ isApp: true, app })
  );
  return {
    ...app,
    metrics: appMetrics,
    lastMetric: appMetrics && appMetrics.length && appMetrics[0],
  };
};
